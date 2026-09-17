import { describe, expect, it } from 'vitest';
import { mapBreakpoint, variantKey } from './breakpoints';

describe('mapBreakpoint', () => {
  it('AS-070: max-width: 991px maps to "medium"', () => {
    expect(mapBreakpoint('max-width: 991px')).toBe('medium');
  });

  it('AS-071: max-width: 767px maps to "small"', () => {
    expect(mapBreakpoint('max-width: 767px')).toBe('small');
  });

  it('AS-072: max-width: 479px maps to "tiny"', () => {
    expect(mapBreakpoint('max-width: 479px')).toBe('tiny');
  });

  it('AS-073: min-width breakpoints map to "large"/"xl"/"xxl"', () => {
    expect(mapBreakpoint('min-width: 1440px')).toBe('large');
    expect(mapBreakpoint('min-width: 1920px')).toBe('xl');
    expect(mapBreakpoint('min-width: 2560px')).toBe('xxl');
  });

  it('AS-048: a max-width that does not exactly match a Webflow boundary returns null (not snapped to "tiny")', () => {
    expect(mapBreakpoint('max-width: 320px')).toBeNull();
  });

  it('AS-048: a max-width above the largest defined boundary returns null (not snapped to "medium")', () => {
    expect(mapBreakpoint('max-width: 1200px')).toBeNull();
  });

  it('AS-048: a min-width above the largest boundary returns null (not snapped to "xxl")', () => {
    expect(mapBreakpoint('min-width: 3000px')).toBeNull();
  });

  it('AS-048: a min-width below the smallest defined boundary returns null (not snapped to "large")', () => {
    expect(mapBreakpoint('min-width: 1000px')).toBeNull();
  });

  it('AS-048: an unmappable media query (e.g. print) returns null', () => {
    expect(mapBreakpoint('print')).toBeNull();
    expect(mapBreakpoint('orientation: landscape')).toBeNull();
  });

  it('is case-insensitive and tolerant of extra whitespace', () => {
    expect(mapBreakpoint('MAX-WIDTH:   991px')).toBe('medium');
  });

  it('parses fractional pixel values that exactly match a boundary', () => {
    expect(mapBreakpoint('max-width: 767.0px')).toBe('small');
  });

  it('AS-048: a fractional pixel value that does not exactly match a boundary returns null', () => {
    expect(mapBreakpoint('max-width: 767.5px')).toBeNull();
  });

  it('AS-048: a compound min-width/max-width range query returns null', () => {
    expect(
      mapBreakpoint('(min-width:768px) and (max-width:991px)'),
    ).toBeNull();
  });

  it('AS-048: a negated query returns null', () => {
    expect(mapBreakpoint('not all and (max-width:767px)')).toBeNull();
  });

  it('AS-048: an "only" prefixed query returns null', () => {
    expect(mapBreakpoint('only screen and (max-width:767px)')).toBeNull();
  });

  it('AS-048: a comma-separated media query list returns null', () => {
    expect(mapBreakpoint('screen, print')).toBeNull();
  });

  it('AS-048: (width <= 767px) range syntax maps to "small"', () => {
    expect(mapBreakpoint('(width <= 767px)')).toBe('small');
  });

  it('AS-048: (width < 768px) range syntax maps to "small" (< N treated as <= N-1)', () => {
    expect(mapBreakpoint('(width < 768px)')).toBe('small');
  });
});

describe('variantKey', () => {
  it('AS-074: a base breakpoint ("main", i.e. no media query) with no state returns null (goes in styleLess as the base/desktop style)', () => {
    expect(variantKey('main', null)).toBeNull();
    expect(variantKey('main', undefined)).toBeNull();
  });

  it('a non-main breakpoint with no state returns the breakpoint key itself', () => {
    expect(variantKey('medium', null)).toBe('medium');
    expect(variantKey('small', null)).toBe('small');
    expect(variantKey('tiny', null)).toBe('tiny');
    expect(variantKey('large', null)).toBe('large');
    expect(variantKey('xl', null)).toBe('xl');
    expect(variantKey('xxl', null)).toBe('xxl');
  });

  it('"main" combined with a hover state returns "main_hover"', () => {
    expect(variantKey('main', 'hover')).toBe('main_hover');
  });

  it('each breakpoint combined with hover returns "<breakpoint>_hover"', () => {
    expect(variantKey('medium', 'hover')).toBe('medium_hover');
    expect(variantKey('small', 'hover')).toBe('small_hover');
    expect(variantKey('tiny', 'hover')).toBe('tiny_hover');
    expect(variantKey('large', 'hover')).toBe('large_hover');
    expect(variantKey('xl', 'hover')).toBe('xl_hover');
    expect(variantKey('xxl', 'hover')).toBe('xxl_hover');
  });

  it('combines a breakpoint with a non-hover state (e.g. pressed)', () => {
    expect(variantKey('main', 'pressed')).toBe('main_pressed');
    expect(variantKey('medium', 'focus')).toBe('medium_focus');
  });
});
