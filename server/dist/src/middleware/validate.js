"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
function validate(schema, where = "body") {
    return (req, res, next) => {
        const data = req[where];
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
            return res.status(400).json({
                error: "VALIDATION_ERROR",
                issues: parsed.error.issues,
            });
        }
        req[where] = parsed.data;
        next();
    };
}
