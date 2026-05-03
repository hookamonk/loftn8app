import { Router } from "express";
import type { PaymentMethod } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { userAuth } from "../../middleware/auth/userAuth";
import { validate } from "../../middleware/validate";
import { parsePaymentItemsJson } from "../payments/paymentAllocation";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { effectiveAvailableAt, summarizeLoyalty } from "../../utils/loyalty";

export const accountRouter = Router();

const UpdateProfileSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(6),
  email: z.string().min(3),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(6).optional(),
  newPassword: z.string().min(6),
});

function normalizePhone(phone: string) {
  const compact = phone.replace(/\s+/g, "").trim();
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (/^\d+$/.test(compact)) {
    if (compact.startsWith("420")) return `+${compact}`;
    return `+420${compact}`;
  }
  return compact;
}

function normalizeEmail(raw?: string | null) {
  const value = String(raw ?? "").trim().toLowerCase();
  return value.length ? value : null;
}

function assertEmail(email: string | null) {
  if (!email) {
    throw new HttpError(400, "EMAIL_REQUIRED", "Email is required");
  }

  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!ok) {
    throw new HttpError(400, "EMAIL_INVALID", "Email is invalid");
  }

  return email;
}

function paymentMethodLabel(method: PaymentMethod) {
  return method === "CARD" ? "Card" : "Cash";
}

function serializeUser(user: {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  privacyAcceptedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email ?? "",
    role: user.role,
    privacyAcceptedAt: user.privacyAcceptedAt,
    createdAt: user.createdAt,
  };
}

function groupReceiptItems(items: ReturnType<typeof parsePaymentItemsJson>) {
  const itemMap = new Map<
    string,
    {
      key: string;
      name: string;
      qty: number;
      totalCzk: number;
      comment?: string;
    }
  >();

  for (const item of items) {
    const key = `${item.menuItemId}:${item.comment ?? ""}`;
    const existing = itemMap.get(key);

    if (existing) {
      existing.qty += item.qty;
      existing.totalCzk += item.totalCzk;
      continue;
    }

    itemMap.set(key, {
      key,
      name: item.name,
      qty: item.qty,
      totalCzk: item.totalCzk,
      comment: item.comment ?? undefined,
    });
  }

  return Array.from(itemMap.values());
}

accountRouter.get(
  "/overview",
  userAuth,
  asyncHandler(async (req, res) => {
    const authUser = req.user!;

    const [user, confirmations, loyaltyTransactions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: authUser.id },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          role: true,
          privacyAcceptedAt: true,
          createdAt: true,
        },
      }),
      prisma.paymentConfirmation.findMany({
        where: { userId: authUser.id },
        orderBy: { createdAt: "desc" },
        include: {
          venue: {
            select: { id: true, slug: true, name: true },
          },
          loyaltyTxn: {
            select: { cashbackCzk: true },
          },
        },
      }),
      prisma.loyaltyTransaction.findMany({
        where: { userId: authUser.id },
        orderBy: { createdAt: "desc" },
        include: {
          venue: {
            select: { id: true, slug: true, name: true },
          },
        },
      }),
    ]);

    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    }

    const receipts = confirmations
      .map((confirmation) => {
        const groupedItems = groupReceiptItems(parsePaymentItemsJson(confirmation.itemsJson));
        const itemCount = groupedItems.reduce((sum, item) => sum + item.qty, 0);

        return {
          id: confirmation.id,
          venue: confirmation.venue,
          method: confirmation.method,
          methodLabel: paymentMethodLabel(confirmation.method),
          amountCzk: confirmation.amountCzk,
          billTotalCzk: confirmation.billTotalCzk,
          loyaltyAppliedCzk: confirmation.loyaltyAppliedCzk,
          cashbackEarnedCzk: confirmation.loyaltyTxn?.cashbackCzk ?? 0,
          closedAt: confirmation.createdAt,
          itemCount,
          items: groupedItems,
        };
      })
      .filter((entry) => entry.itemCount > 0 || entry.amountCzk > 0);

    const loyaltySummary = summarizeLoyalty(loyaltyTransactions);
    const loyaltyHistory = loyaltyTransactions.map((txn) => {
      const availableAt = effectiveAvailableAt(txn);
      const redeemedAmountCzk = txn.redeemedAmountCzk ?? 0;
      const remainingCzk = Math.max(txn.cashbackCzk - redeemedAmountCzk, 0);
      const isAvailable = remainingCzk > 0 && availableAt.getTime() <= Date.now();

      let status: "available" | "pending" | "redeemed" | "partial" = "pending";
      if (remainingCzk === 0) status = "redeemed";
      else if (isAvailable) status = "available";
      else if (redeemedAmountCzk > 0) status = "partial";

      return {
        id: txn.id,
        venue: txn.venue,
        createdAt: txn.createdAt,
        availableAt,
        baseAmountCzk: txn.baseAmountCzk,
        cashbackCzk: txn.cashbackCzk,
        redeemedAmountCzk,
        remainingCzk,
        status,
      };
    });

    res.json({
      ok: true,
      user: serializeUser(user),
      loyalty: {
        availableCzk: loyaltySummary.availableCzk,
        pendingCzk: loyaltySummary.pendingCzk,
        nextAvailableAt: loyaltySummary.nextAvailableAt,
        cashbackPercent: 10,
        history: loyaltyHistory,
      },
      receipts,
    });
  })
);

accountRouter.patch(
  "/me",
  userAuth,
  validate(UpdateProfileSchema),
  asyncHandler(async (req, res) => {
    const authUser = req.user!;
    const name = String((req.body as any).name ?? "").trim();
    const phone = normalizePhone(String((req.body as any).phone ?? ""));
    const email = assertEmail(normalizeEmail((req.body as any).email));

    if (!name) {
      throw new HttpError(400, "NAME_REQUIRED", "Name is required");
    }

    const [phoneOwner, emailOwner] = await Promise.all([
      prisma.user.findUnique({ where: { phone } }),
      prisma.user.findUnique({ where: { email } }).catch(() => null),
    ]);

    if (phoneOwner && phoneOwner.id !== authUser.id) {
      throw new HttpError(409, "PHONE_IN_USE", "Phone is already used by another account");
    }

    if (emailOwner && emailOwner.id !== authUser.id) {
      throw new HttpError(409, "EMAIL_IN_USE", "Email is already used by another account");
    }

    const updatedUser = await prisma.user.update({
      where: { id: authUser.id },
      data: {
        name,
        phone,
        email,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        privacyAcceptedAt: true,
        createdAt: true,
      },
    });

    res.json({
      ok: true,
      user: serializeUser(updatedUser),
    });
  })
);

accountRouter.post(
  "/change-password",
  userAuth,
  validate(ChangePasswordSchema),
  asyncHandler(async (req, res) => {
    const authUser = req.user!;
    const currentPassword = String((req.body as any).currentPassword ?? "");
    const newPassword = String((req.body as any).newPassword ?? "");

    if (authUser.passwordHash) {
      if (!currentPassword) {
        throw new HttpError(400, "CURRENT_PASSWORD_REQUIRED", "Current password is required");
      }

      const ok = await bcrypt.compare(currentPassword, authUser.passwordHash);
      if (!ok) {
        throw new HttpError(400, "PASSWORD_INVALID", "Current password is invalid");
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: authUser.id },
      data: { passwordHash },
    });

    res.json({ ok: true });
  })
);
