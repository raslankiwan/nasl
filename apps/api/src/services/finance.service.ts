import mongoose, { type ClientSession } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { AnimalClass } from '@nasl/shared';
import { isWithdrawalActive } from '@nasl/shared';
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
  private readonly animals: AnimalRepository;
  private readonly transactions: TenantRepository<TransactionDoc>;
  private readonly feed: TenantRepository<FeedLogDoc>;
  private readonly milk: TenantRepository<MilkDispositionDoc>;
  private readonly transactional: boolean;
  constructor(transactional = false, session?: ClientSession) {
    this.transactional = transactional;
    this.animals = new AnimalRepository(undefined, session);
    this.transactions = new TenantRepository(Transaction, undefined, session);
    this.feed = new TenantRepository(FeedLog, undefined, session);
    this.milk = new TenantRepository(MilkDisposition, undefined, session);
  }

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
  ): Promise<TransactionDoc> {
    const request = { ...input, id: input.id ?? randomUUID() };
    if (this.transactional) {
      return mongoose.connection.transaction((session) =>
        new FinanceService(false, session).recordSale(farmId, request, recordedBy),
      );
    }
    const previous = await this.transactions.findById(farmId, request.id);
    if (previous) {
      if (
        previous.type !== 'sale' ||
        previous.amount !== input.amount ||
        previous.date.getTime() !== input.date.getTime() ||
        [...previous.animalIds].sort().join(',') !== [...input.animalIds].sort().join(',')
      )
        throw AppError.conflict('This sale ID is already used.');
      return previous;
    }
    if (new Set(input.animalIds).size !== input.animalIds.length)
      throw AppError.badRequest('Choose each animal only once.');
    const today = new Date();
    if (!Number.isFinite(input.date.getTime()) || input.date > today)
      throw AppError.badRequest('Choose a sale date up to today.');
    const animals = [];

    for (const animalId of input.animalIds) {
      const animal = await this.animals.findById(farmId, animalId);
      if (!animal) throw AppError.badRequest('One of those animals is not in this flock.');
      if (animal.status !== 'active') throw AppError.conflict('Only active animals can be sold.');
      if (animal.dateOfBirth && input.date < animal.dateOfBirth)
        throw AppError.badRequest('A sale cannot predate birth.');

      if (isWithdrawalActive(animal.withholdMeatUntil, today)) {
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
      _id: request.id,
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
      await this.animals.changeStatus(
        farmId,
        animal._id,
        { id: request.id, status: 'sold', date: input.date, reason: input.note },
        recordedBy,
      );
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
      animals: Array<{
        tagNumber?: string;
        classification?: AnimalClass;
        dateOfBirth?: string;
        species: string;
        sex: string;
        breedId?: string;
      }>;
    },
    recordedBy: string,
  ) {
    const created: string[] = [];
    for (const animal of input.animals) {
      const registered = await this.animals.register(farmId, {
        species: animal.species,
        sex: animal.sex,
        breedId: animal.breedId,
        classification: animal.classification ?? 'child',
        ...(animal.dateOfBirth ? { dateOfBirth: new Date(animal.dateOfBirth) } : {}),
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
