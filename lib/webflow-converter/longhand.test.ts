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

describe('splitTop', () => {
  it('splits on top-level whitespace but keeps parens intact', () => {
    expect(splitTop('1px var(--a, 2px) 3px')).toEqual(['1px', 'var(--a, 2px)', '3px']);
  });
});
