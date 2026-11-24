import { Decimal } from "@prisma/client/runtime/library";

export function roundMoney(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

export function money(n: number): Decimal {
  return new Decimal(roundMoney(n));
}

export function num(value: Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return roundMoney(value);
  return roundMoney(Number(value.toString()));
}
