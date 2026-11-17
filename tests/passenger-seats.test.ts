import { describe, expect, it } from 'vitest';
import { cabinSeatPoint, DEFAULT_CABIN_SEAT } from '../src/shared/passengerSeats';

describe('passenger seat positions', () => {
  it('changes longitudinal position by row and lateral position by column', () => {
    expect(cabinSeatPoint('1A')[0]).not.toBe(cabinSeatPoint('4A')[0]);
    expect(cabinSeatPoint('1A')[2]).not.toBe(cabinSeatPoint('1F')[2]);
    expect(cabinSeatPoint('invalid')).toEqual(cabinSeatPoint(DEFAULT_CABIN_SEAT));
  });
});
