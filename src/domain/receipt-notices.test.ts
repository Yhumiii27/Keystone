// Recipients of the receipt notices (R-096: NEW-D4-3 "a", SC-3b "a"; R-015: X-6a) — pure rules: the buyer chain
// (submitted by → created by → RFQ owner, first with an active account), the procurement stand-in when no buyer has an
// account, the leads (rejection) or directors (invoice blocked), and the actor never told.
import { describe, expect, it } from 'vitest';
import { invoiceBlockedRecipients, newlyBlockedInvoices, orderBuyer, rejectionRecipients } from './receipt-notices';

const active = new Set(['sub', 'author', 'rfq', 'pm', 'deputy', 'buyer2', 'proc1', 'proc2', 'dir']);

describe('orderBuyer', () => {
  it('submitted by, else created by, else the RFQ owner — the first with an active account', () => {
    expect(orderBuyer(['sub', 'author', 'rfq'], active)).toBe('sub');
    expect(orderBuyer([null, 'author', 'rfq'], active)).toBe('author');
    expect(orderBuyer(['gone', undefined, 'rfq'], active)).toBe('rfq');
    expect(orderBuyer(['gone', null, null], active)).toBeNull();
    expect(orderBuyer([], active)).toBeNull();
  });
});

describe('rejectionRecipients', () => {
  const procurement = ['proc1', 'proc2'];
  it('the buyer and the project leads, without duplicates', () => {
    expect(rejectionRecipients({ buyerChain: ['sub', 'author'], leads: ['pm', 'deputy', 'sub'], procurement }, { active, actor: 'someone' })).toEqual(['sub', 'pm', 'deputy']);
  });

  it('no buyer with an account → the procurement users stand in (the actor removed)', () => {
    expect(rejectionRecipients({ buyerChain: ['gone', null, null], leads: ['pm'], procurement }, { active, actor: 'proc1' })).toEqual(['proc2', 'pm']);
  });

  it('the buyer is the actor → nobody stands in for them; the leads are still told', () => {
    expect(rejectionRecipients({ buyerChain: ['sub', 'author', 'rfq'], leads: ['pm'], procurement }, { active, actor: 'sub' })).toEqual(['pm']);
  });

  it('the actor is removed everywhere, and persons without an active account are never addressed', () => {
    expect(rejectionRecipients({ buyerChain: ['sub'], leads: ['pm', 'no-account'], procurement }, { active, actor: 'pm' })).toEqual(['sub']);
    expect(rejectionRecipients({ buyerChain: [], leads: [], procurement: [] }, { active, actor: null })).toEqual([]);
  });
});

describe('invoiceBlockedRecipients', () => {
  it('the buyer (else procurement) and the directors (prototype n8), the actor removed', () => {
    expect(invoiceBlockedRecipients({ buyerChain: ['sub'], directors: ['dir'], procurement: ['proc1'] }, { active, actor: 'qa' })).toEqual(['sub', 'dir']);
    expect(invoiceBlockedRecipients({ buyerChain: [null], directors: ['dir'], procurement: ['proc1'] }, { active, actor: 'dir' })).toEqual(['proc1']);
    expect(invoiceBlockedRecipients({ buyerChain: ['sub'], directors: ['dir'], procurement: ['proc1'] }, { active, actor: 'sub' })).toEqual(['dir']);
  });
});

describe('newlyBlockedInvoices', () => {
  it('only "Awaiting receipt" → "Blocked"', () => {
    const before = new Map([['INV-1', 'awaiting_receipt'], ['INV-2', 'blocked'], ['INV-3', 'awaiting_receipt'], ['INV-4', 'no_po']]);
    const after = new Map([['INV-1', 'blocked'], ['INV-2', 'blocked'], ['INV-3', 'awaiting_receipt'], ['INV-4', 'blocked'], ['INV-5', 'blocked']]);
    expect(newlyBlockedInvoices(before, after)).toEqual(['INV-1']);
  });
});
