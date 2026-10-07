import { describe, expect, it } from 'vitest';
import { searchDbFields } from '../src/core/dbFields.js';

const fields = [
  { identifier: 'PRIMARY_LEGAL_ADDRESS', label: 'Primary Legal Address' },
  { identifier: 'PRIMARY_ADDRESS', label: 'Primary Address' },
  { identifier: 'JOINT_ADDRESS', label: 'Joint Address' },
  { identifier: 'CUSTNAME', label: 'Customer Name' },
];
const ids = (q) => searchDbFields(fields, q).map((f) => f.identifier);

describe('searchDbFields', () => {
  it('matches words in any position, closest first', () => {
    expect(ids('primary address')).toEqual(['PRIMARY_ADDRESS', 'PRIMARY_LEGAL_ADDRESS']);
    expect(ids('address primary')).toEqual(['PRIMARY_ADDRESS', 'PRIMARY_LEGAL_ADDRESS']);
  });
  it('treats underscores and spaces alike', () => {
    expect(ids('primary_legal')).toEqual(['PRIMARY_LEGAL_ADDRESS']);
  });
  it('matches word prefixes across identifier and label', () => {
    expect(ids('cust name')).toEqual(['CUSTNAME']);
    expect(ids('jo addr')).toEqual(['JOINT_ADDRESS']);
  });
});
