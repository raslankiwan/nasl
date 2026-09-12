import { isUnderMeatWithdrawal } from '@nasl/shared';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import {
  FeedLog,
  Transaction,
  type FeedLogDoc,
  type TransactionDoc,
} from '../models/finance.model.ts';
import { Farm } from '../models/farm.model.ts';
import { MilkDisposition, type MilkDispositionDoc } from '../models/milk.model.ts';

/**
 * Money in and out (M8).
 *
 * Deliberately not accounting: sales, purchases, expenses and what a pen was fed. A herder will
 * not maintain a ledger, and the useful question is "did this season pay", not "does it balance".
 */
export class FinanceService {
  private readonly animals = new AnimalRepository();
  private readonly transactions = new TenantRepository<TransactionDoc>(Transaction);
  private readonly feed = new TenantRepository<FeedLogDoc>(FeedLog);
  private readonly milk = new TenantRepository<MilkDispositionDoc>(MilkDisposition);

  private async currencyFor(farmId: string): Promise<string> {
    const farm = await Farm.findById(farmId).select('currency').lean().exec();
    return farm?.currency ?? 'ILS';
  }

  /**
   * Record a sale, and take the animals off the flock.
   *
   * The withdrawal gate lives here as well as on the status change, because this is the other door
   * an animal can leave through. A treated ewe must not be sold for meat from either one.
   */
  async recordSale(
    farmId: string,
    input: {
      id?: string;
      animalIds: string[];
      amount: number;
      date: Date;
      counterparty?: string;
      note?: string;
      paid?: boolean;
    },
    recordedBy: string,
  ) {
    const today = new Date();
    const animals = [];

    for (const animalId of input.animalIds) {
      const animal = await this.animals.findById(farmId, animalId);
      if (!animal) throw AppError.badRequest('One of those animals is not in this flock.');

      if (
        isUnderMeatWithdrawal(
          { withholdMeatUntil: animal.withholdMeatUntil?.toISOString() ?? undefined },
          today,
        )
      ) {
        throw AppError.conflict(
          `Tag ${animal.tagNumber} is under a withdrawal period until ${animal
            .withholdMeatUntil!.toISOString()
            .slice(0, 10)} and cannot be sold for meat.`,
          { animalId, tagNumber: animal.tagNumber, withholdMeatUntil: animal.withholdMeatUntil },
        );
      }
      animals.push(animal);
    }

    const transaction = await this.transactions.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      type: 'sale',
      amount: input.amount,
      currency: await this.currencyFor(farmId),
      date: input.date,
      animalIds: input.animalIds,
      counterparty: input.counterparty ?? null,
      note: input.note ?? null,
      paid: input.paid ?? true,
      recordedBy,
    } as Partial<TransactionDoc>);

    for (const animal of animals) {
      await this.animals.updateById(farmId, animal._id, { $set: { status: 'sold' } });
    }

    return transaction;
  }

  /** Buying animals in registers them in the same action — otherwise it happens twice or not at all. */
  async recordPurchase(
    farmId: string,
    input: {
      id?: string;
      amount: number;
      date: Date;
      counterparty?: string;
      animals: Array<{ tagNumber: string; species: string; sex: string; breedId?: string }>;
    },
    recordedBy: string,
  ) {
    const created: string[] = [];
    for (const animal of input.animals) {
      const registered = await this.animals.register(farmId, {
        ...animal,
        origin: 'purchased',
        acquiredAt: input.date,
        dobIsEstimate: true,
      } as never);
      created.push(registered._id);
    }

    const transaction = await this.transactions.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      type: 'purchase',
      amount: input.amount,
      currency: await this.currencyFor(farmId),
      date: input.date,
      animalIds: created,
      counterparty: input.counterparty ?? null,
      paid: true,
      recordedBy,
    } as Partial<TransactionDoc>);

    return { transaction, animalIds: created };
  }

  async recordExpense(
    farmId: string,
    input: { id?: string; category: string; amount: number; date: Date; note?: string },
    recordedBy: string,
  ) {
    return this.transactions.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      type: 'expense',
      category: input.category,
      amount: input.amount,
      currency: await this.currencyFor(farmId),
      date: input.date,
      note: input.note ?? null,
      paid: true,
      recordedBy,
    } as Partial<TransactionDoc>);
  }

  async recordFeed(
    farmId: string,
    input: {
      id?: string;
      groupId?: string;
      date: Date;
      feedType: string;
      qtyKg: number;
      cost?: number;
    },
    recordedBy: string,
  ) {
    return this.feed.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      groupId: input.groupId ?? null,
      date: input.date,
      feedType: input.feedType,
      qtyKg: input.qtyKg,
      cost: input.cost ?? null,
      currency: await this.currencyFor(farmId),
      recordedBy,
    } as Partial<FeedLogDoc>);
  }

  /**
   * Did this period pay (FR-FIN-05)?
   *
   * Feed logged separately is folded into expenses, so the answer does not depend on whether the
   * herder recorded a feed delivery as a feed log or as an expense.
   */
  async profitAndLoss(farmId: string, from: Date, to: Date) {
    const range = { date: { $gte: from, $lte: to } };
    const [transactions, feed, milkBatches, headCount] = await Promise.all([
      this.transactions.find(farmId, range as never, { limit: 1000 }),
      this.feed.find(farmId, range as never, { limit: 1000 }),
      this.milk.find(farmId, range as never, { limit: 2000 }),
      this.animals.count(farmId, { status: 'active' } as never),
    ]);

    const sum = (rows: Array<{ amount: number }>) => rows.reduce((total, r) => total + r.amount, 0);

    const sales = transactions.filter((t) => t.type === 'sale');
    const purchases = transactions.filter((t) => t.type === 'purchase');
    const expenses = transactions.filter((t) => t.type === 'expense');
    // Anything recorded as plain income — a fleece sale, a stud fee — counted rather than dropped.
    const other = transactions.filter((t) => t.type === 'income');
    const feedCost = feed.reduce((total, f) => total + (f.cost ?? 0), 0);

    // Milk is its own income line and is not posted as a transaction: the batch record is the one
    // place a price lives, so editing a sale cannot leave two numbers disagreeing.
    const milkIncome = milkBatches.reduce((total, b) => total + (b.revenue ?? 0), 0);
    const milkKg = milkBatches.reduce((total, b) => total + b.milkKg, 0);

    const byCategory: Record<string, number> = {};
    for (const expense of expenses) {
      const key = expense.category ?? 'other';
      byCategory[key] = (byCategory[key] ?? 0) + expense.amount;
    }
    if (feedCost > 0) byCategory.feed = (byCategory.feed ?? 0) + feedCost;

    const animalIncome = sum(sales);
    const income = animalIncome + sum(other) + milkIncome;
    const outgoings = sum(purchases) + sum(expenses) + feedCost;

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      currency: await this.currencyFor(farmId),
      income,
      animalIncome,
      milkIncome: Number(milkIncome.toFixed(2)),
      milkKg: Number(milkKg.toFixed(1)),
      otherIncome: sum(other),
      salesCount: sales.length,
      animalsSold: sales.reduce((n, s) => n + s.animalIds.length, 0),
      outgoings,
      expensesByCategory: byCategory,
      feedKg: feed.reduce((total, f) => total + f.qtyKg, 0),
      net: Number((income - outgoings).toFixed(2)),
      headCount,
      costPerHead: headCount > 0 ? Number((outgoings / headCount).toFixed(2)) : null,
    };
  }
}
