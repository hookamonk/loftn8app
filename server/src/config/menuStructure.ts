import { MenuSection } from "@prisma/client";

export type MenuCategoryDefinition = {
  name: string;
  sort: number;
  section: MenuSection;
};

const DISHES: Array<[string, number]> = [
  ["APPETIZERS / SNACKS", 1],
  ["SALADS / SOUPS", 2],
  ["FISH / MEAT", 3],
  ["GRILL", 4],
  ["PASTA", 5],
  ["BURGERS / SANDWICHES", 6],
  ["SUSHI", 7],
  ["SPECIALITY", 8],
  ["SIDE DISHES / SAUCES", 9],
  ["DESSERTS", 10],
];

const DRINKS: Array<[string, number]> = [
  ["COCKTAILS", 10],
  ["SPIRITS · Rum", 20],
  ["SPIRITS · Cognac", 21],
  ["SPIRITS · Gin", 22],
  ["SPIRITS · Aperetiv", 23],
  ["SPIRITS · Tequila", 24],
  ["SPIRITS · Vodka", 25],
  ["SPIRITS · Whisky", 26],
  ["BEER", 30],
  ["WINE · Red", 40],
  ["WINE · Rosé", 41],
  ["WINE · White", 42],
  ["WINE · Sparkling", 43],
  ["SOFT DRINKS", 50],
  ["HOT DRINKS · Tea", 60],
  ["HOT DRINKS · Coffee", 61],
];

const HOOKAH: Array<[string, number]> = [
  ["CLASSIC HOOKAH", 1],
  ["WARP ELECTRONIC HOOKAH", 2],
  ["EXTRA", 3],
];

export function defaultMenuCategoryDefinitions(): MenuCategoryDefinition[] {
  return [
    ...DISHES.map(([name, sort]) => ({ name, sort, section: "DISHES" as MenuSection })),
    ...DRINKS.map(([name, sort]) => ({ name, sort, section: "DRINKS" as MenuSection })),
    ...HOOKAH.map(([name, sort]) => ({ name, sort, section: "HOOKAH" as MenuSection })),
  ];
}
