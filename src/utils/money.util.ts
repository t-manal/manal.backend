import Decimal from 'decimal.js';

export class Money {
    private readonly amount: Decimal;

    private constructor(value: Decimal) {
        this.amount = value;
    }

    static fromNumber(value: number | string | Decimal): Money {
        return new Money(new Decimal(value));
    }

    static zero(): Money {
        return new Money(new Decimal(0));
    }

    add(other: Money): Money {
        return new Money(this.amount.plus(other.amount));
    }

    subtract(other: Money): Money {
        return new Money(this.amount.minus(other.amount));
    }

    greaterThan(other: Money): boolean {
        return this.amount.greaterThan(other.amount);
    }

    lessThan(other: Money): boolean {
        return this.amount.lessThan(other.amount);
    }

    lessThanOrEqualTo(other: Money): boolean {
        return this.amount.lessThanOrEqualTo(other.amount);
    }

    greaterThanOrEqualTo(other: Money): boolean {
        return this.amount.greaterThanOrEqualTo(other.amount);
    }

    equals(other: Money): boolean {
        return this.amount.equals(other.amount);
    }

    toNumber(): number {
        return this.amount.toNumber();
    }

    toString(): string {
        return this.amount.toFixed(2);
    }

    /**
     * Returns the raw Decimal object for cases where direct access is needed
     * (e.g. Prisma Decimal compatibility)
     */
    toDecimal(): Decimal {
        return this.amount;
    }
}
