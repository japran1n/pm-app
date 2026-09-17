import { describe, expect, it } from 'vitest';
import { expandDeclaration, isShorthand, splitTop } from './longhand';

describe('AS-053: margin shorthand 1/2/3/4-value expansion', () => {
  it('test_AS_053_one_value_applies_to_all_sides', () => {
    expect(expandDeclaration('margin', '10px')).toEqual({
      decls: {
        'margin-top': '10px',
        'margin-right': '10px',
        'margin-bottom': '10px',
        'margin-left': '10px',
      },
    });
  });

  it('test_AS_053_two_values_vertical_horizontal', () => {
    expect(expandDeclaration('margin', '10px 20px')).toEqual({
      decls: {
        'margin-top': '10px',
        'margin-right': '20px',
        'margin-bottom': '10px',
        'margin-left': '20px',
      },
    });
  });

  it('test_AS_053_three_values_top_horizontal_bottom', () => {
    expect(expandDeclaration('margin', '10px 20px 30px')).toEqual({
      decls: {
        'margin-top': '10px',
        'margin-right': '20px',
        'margin-bottom': '30px',
        'margin-left': '20px',
      },
    });
  });

  it('test_AS_053_four_values_top_right_bottom_left', () => {
    expect(expandDeclaration('margin', '10px 20px 30px 40px')).toEqual({
      decls: {
        'margin-top': '10px',
        'margin-right': '20px',
        'margin-bottom': '30px',
        'margin-left': '40px',
      },
    });
  });

  it('test_AS_053_keeps_var_and_calc_intact_when_splitting', () => {
    expect(expandDeclaration('margin', 'var(--x) calc(1px + 2px)')).toEqual({
      decls: {
        'margin-top': 'var(--x)',
        'margin-right': 'calc(1px + 2px)',
        'margin-bottom': 'var(--x)',
        'margin-left': 'calc(1px + 2px)',
      },
    });
  });
});

describe('AS-054: padding shorthand expands the same way as margin', () => {
  it('test_AS_054_one_value_applies_to_all_sides', () => {
    expect(expandDeclaration('padding', '5px')).toEqual({
      decls: {
        'padding-top': '5px',
        'padding-right': '5px',
        'padding-bottom': '5px',
        'padding-left': '5px',
      },
    });
  });

  it('test_AS_054_two_values_vertical_horizontal', () => {
    expect(expandDeclaration('padding', '5px 15px')).toEqual({
      decls: {
        'padding-top': '5px',
        'padding-right': '15px',
        'padding-bottom': '5px',
        'padding-left': '15px',
      },
    });
  });

  it('test_AS_054_three_values_top_horizontal_bottom', () => {
    expect(expandDeclaration('padding', '1px 2px 3px')).toEqual({
      decls: {
        'padding-top': '1px',
        'padding-right': '2px',
        'padding-bottom': '3px',
        'padding-left': '2px',
      },
    });
  });

  it('test_AS_054_four_values_top_right_bottom_left', () => {
    expect(expandDeclaration('padding', '1px 2px 3px 4px')).toEqual({
      decls: {
        'padding-top': '1px',
        'padding-right': '2px',
        'padding-bottom': '3px',
        'padding-left': '4px',
      },
    });
  });
});

describe('inset shorthand — same box rule, longhand names are the bare side keywords', () => {
  it('test_inset_one_value_applies_to_all_sides', () => {
    expect(expandDeclaration('inset', '0')).toEqual({
      decls: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  });

  it('test_inset_four_values_top_right_bottom_left', () => {
    expect(expandDeclaration('inset', '1px 2px 3px 4px')).toEqual({
      decls: { top: '1px', right: '2px', bottom: '3px', left: '4px' },
    });
  });
});

describe('AS-068: global keyword on a shorthand is dropped with a warning', () => {
  it('test_AS_068_inherit_on_margin_is_dropped_with_warning', () => {
    const result = expandDeclaration('margin', 'inherit');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
    expect(result.warning).toContain('margin: inherit');
  });

  it('test_AS_068_initial_on_padding_is_dropped_with_warning', () => {
    const result = expandDeclaration('padding', 'initial');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });

  it('test_AS_068_unset_on_inset_is_dropped_with_warning', () => {
    const result = expandDeclaration('inset', 'unset');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });

  it('test_AS_068_revert_on_margin_is_dropped_with_warning', () => {
    const result = expandDeclaration('margin', 'revert');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });

  it('test_AS_068_global_keyword_is_case_insensitive', () => {
    const result = expandDeclaration('margin', 'INHERIT');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });

  it('test_AS_068_global_keyword_on_non_shorthand_property_is_not_dropped', () => {
    // color is not in the SHORTHANDS set, so a global keyword there is a
    // valid, unambiguous longhand value and must pass through unchanged.
    const result = expandDeclaration('color', 'inherit');
    expect(result.decls).toEqual({ color: 'inherit' });
    expect(result.warning).toBeUndefined();
  });
});

describe('empty / zero state', () => {
  it('test_default_pass_through_for_unrelated_property', () => {
    expect(expandDeclaration('color', 'red')).toEqual({ decls: { color: 'red' } });
  });
});

describe('isShorthand', () => {
  it('recognizes margin/padding/inset as shorthands', () => {
    expect(isShorthand('margin')).toBe(true);
    expect(isShorthand('padding')).toBe(true);
    expect(isShorthand('inset')).toBe(true);
    expect(isShorthand('MARGIN')).toBe(true);
  });

  it('does not treat a plain longhand as a shorthand', () => {
    expect(isShorthand('color')).toBe(false);
  });
});

describe('AS-058: gap shorthand expands to row-gap + column-gap', () => {
  it('test_AS_058_one_value_applies_to_row_and_column', () => {
    expect(expandDeclaration('gap', '10px')).toEqual({
      decls: { 'row-gap': '10px', 'column-gap': '10px' },
    });
  });

  it('test_AS_058_two_values_row_then_column', () => {
    expect(expandDeclaration('gap', '10px 20px')).toEqual({
      decls: { 'row-gap': '10px', 'column-gap': '20px' },
    });
  });

  it('test_AS_058_global_keyword_on_gap_is_dropped_with_warning', () => {
    const result = expandDeclaration('gap', 'inherit');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });
});

describe('AS-059: overflow shorthand expands to overflow-x + overflow-y', () => {
  it('test_AS_059_one_value_applies_to_x_and_y', () => {
    expect(expandDeclaration('overflow', 'hidden')).toEqual({
      decls: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
  });

  it('test_AS_059_two_values_x_then_y', () => {
    expect(expandDeclaration('overflow', 'hidden scroll')).toEqual({
      decls: { 'overflow-x': 'hidden', 'overflow-y': 'scroll' },
    });
  });

  it('test_AS_059_global_keyword_on_overflow_is_dropped_with_warning', () => {
    const result = expandDeclaration('overflow', 'unset');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });
});

describe('AS-060: place-items/place-content/place-self expand to align-* + justify-*', () => {
  it('test_AS_060_place_items_one_value_applies_to_align_and_justify', () => {
    expect(expandDeclaration('place-items', 'center')).toEqual({
      decls: { 'align-items': 'center', 'justify-items': 'center' },
    });
  });

  it('test_AS_060_place_items_two_values_align_then_justify', () => {
    expect(expandDeclaration('place-items', 'start end')).toEqual({
      decls: { 'align-items': 'start', 'justify-items': 'end' },
    });
  });

  it('test_AS_060_place_content_one_value_applies_to_align_and_justify', () => {
    expect(expandDeclaration('place-content', 'space-between')).toEqual({
      decls: { 'align-content': 'space-between', 'justify-content': 'space-between' },
    });
  });

  it('test_AS_060_place_content_two_values_align_then_justify', () => {
    expect(expandDeclaration('place-content', 'center stretch')).toEqual({
      decls: { 'align-content': 'center', 'justify-content': 'stretch' },
    });
  });

  it('test_AS_060_place_self_one_value_applies_to_align_and_justify', () => {
    expect(expandDeclaration('place-self', 'end')).toEqual({
      decls: { 'align-self': 'end', 'justify-self': 'end' },
    });
  });

  it('test_AS_060_place_self_two_values_align_then_justify', () => {
    expect(expandDeclaration('place-self', 'start center')).toEqual({
      decls: { 'align-self': 'start', 'justify-self': 'center' },
    });
  });

  it('test_AS_060_global_keyword_on_place_items_is_dropped_with_warning', () => {
    const result = expandDeclaration('place-items', 'revert');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });
});

describe('isShorthand recognizes gap/overflow/place-* shorthands', () => {
  it('recognizes gap, overflow, place-items, place-content, place-self', () => {
    expect(isShorthand('gap')).toBe(true);
    expect(isShorthand('overflow')).toBe(true);
    expect(isShorthand('place-items')).toBe(true);
    expect(isShorthand('place-content')).toBe(true);
    expect(isShorthand('place-self')).toBe(true);
  });
});

describe('AS-063: transition shorthand expands to property/duration/timing-function/delay', () => {
  it('test_AS_063_single_item_expands_with_defaults_for_missing_parts', () => {
    expect(expandDeclaration('transition', 'opacity .2s')).toEqual({
      decls: {
        'transition-property': 'opacity',
        'transition-duration': '.2s',
        'transition-timing-function': 'ease',
        'transition-delay': '0s',
      },
    });
  });

  it('test_AS_063_single_item_with_all_four_parts', () => {
    expect(expandDeclaration('transition', 'transform .3s ease-in-out .1s')).toEqual({
      decls: {
        'transition-property': 'transform',
        'transition-duration': '.3s',
        'transition-timing-function': 'ease-in-out',
        'transition-delay': '.1s',
      },
    });
  });

  it('test_AS_063_global_keyword_on_transition_is_dropped_with_warning', () => {
    const result = expandDeclaration('transition', 'inherit');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });
});

describe('AS-064: transition keeps parallel comma-separated multi-item lists aligned by position', () => {
  it('test_AS_064_two_items_with_explicit_delay_on_second', () => {
    const d = expandDeclaration(
      'transition',
      'background-color .2s ease, transform .15s cubic-bezier(.2,.8,.2,1) .05s',
    ).decls;
    expect(d['transition-property']).toBe('background-color, transform');
    expect(d['transition-duration']).toBe('.2s, .15s');
    expect(d['transition-delay']).toBe('0s, .05s');
    expect(d['transition-timing-function']).toBe('ease, cubic-bezier(.2,.8,.2,1)');
  });

  it('test_AS_064_three_items_stay_positionally_aligned', () => {
    const d = expandDeclaration('transition', 'opacity .1s, transform .2s linear, color .3s ease .05s').decls;
    expect(d['transition-property']).toBe('opacity, transform, color');
    expect(d['transition-duration']).toBe('.1s, .2s, .3s');
    expect(d['transition-timing-function']).toBe('ease, linear, ease');
    expect(d['transition-delay']).toBe('0s, 0s, .05s');
  });
});

describe('isShorthand recognizes transition', () => {
  it('recognizes transition as a shorthand', () => {
    expect(isShorthand('transition')).toBe(true);
  });
});

describe('splitTop', () => {
  it('splits on top-level whitespace but keeps parens intact', () => {
    expect(splitTop('1px var(--a, 2px) 3px')).toEqual(['1px', 'var(--a, 2px)', '3px']);
  });
});
