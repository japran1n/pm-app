import { describe, expect, it } from 'vitest';
import { expandDeclaration, isShorthand, PASS_THROUGH, splitTop } from './longhand';
// css-shorthand-properties ships no type declarations.
const cssShorthandPropsRequire: {
  shorthandProperties?: Record<string, unknown>;
  default?: { shorthandProperties: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('css-shorthand-properties');

const shorthandProperties: Record<string, unknown> =
  cssShorthandPropsRequire.shorthandProperties ?? cssShorthandPropsRequire.default?.shorthandProperties ?? {};

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

describe('AS-061: flex shorthand expansion (none/auto/single/2-value/3-value forms)', () => {
  it('test_AS_061_none_keyword', () => {
    expect(expandDeclaration('flex', 'none').decls).toEqual({
      'flex-grow': '0',
      'flex-shrink': '0',
      'flex-basis': 'auto',
    });
  });

  it('test_AS_061_auto_keyword', () => {
    expect(expandDeclaration('flex', 'auto').decls).toEqual({
      'flex-grow': '1',
      'flex-shrink': '1',
      'flex-basis': 'auto',
    });
  });

  it('test_AS_061_initial_keyword_is_caught_by_global_keyword_guard', () => {
    // "initial" is a CSS-wide global keyword, so — like the reference
    // prototype — it's dropped by the shorthand's global-keyword guard
    // before expandFlex ever sees it.
    const r = expandDeclaration('flex', 'initial');
    expect(r.decls).toEqual({});
    expect(r.warning).toMatch(/dropped/);
  });

  it('test_AS_061_single_unitless_number_is_grow', () => {
    expect(expandDeclaration('flex', '2').decls).toEqual({
      'flex-grow': '2',
      'flex-shrink': '1',
      'flex-basis': '0%',
    });
  });

  it('test_AS_061_single_value_basis_length', () => {
    expect(expandDeclaration('flex', '30px').decls).toEqual({
      'flex-grow': '1',
      'flex-shrink': '1',
      'flex-basis': '30px',
    });
  });

  it('test_AS_061_two_values_grow_shrink', () => {
    expect(expandDeclaration('flex', '2 3').decls).toEqual({
      'flex-grow': '2',
      'flex-shrink': '3',
      'flex-basis': '0%',
    });
  });

  it('test_AS_061_two_values_grow_basis', () => {
    expect(expandDeclaration('flex', '2 30px').decls).toEqual({
      'flex-grow': '2',
      'flex-shrink': '1',
      'flex-basis': '30px',
    });
  });

  it('test_AS_061_three_values_grow_shrink_basis', () => {
    expect(expandDeclaration('flex', '2 1 30px').decls).toEqual({
      'flex-grow': '2',
      'flex-shrink': '1',
      'flex-basis': '30px',
    });
  });

  it('test_AS_061_recognizes_flex_as_shorthand', () => {
    expect(isShorthand('flex')).toBe(true);
  });

  it('test_AS_061_global_keyword_is_dropped_with_warning', () => {
    const r = expandDeclaration('flex', 'inherit');
    expect(r.decls).toEqual({});
    expect(r.warning).toMatch(/dropped/);
  });
});

describe('AS-062: flex-flow shorthand expansion', () => {
  it('test_AS_062_direction_only', () => {
    expect(expandDeclaration('flex-flow', 'column').decls).toEqual({
      'flex-direction': 'column',
    });
  });

  it('test_AS_062_wrap_only', () => {
    expect(expandDeclaration('flex-flow', 'wrap').decls).toEqual({
      'flex-wrap': 'wrap',
    });
  });

  it('test_AS_062_direction_and_wrap', () => {
    expect(expandDeclaration('flex-flow', 'row-reverse wrap-reverse').decls).toEqual({
      'flex-direction': 'row-reverse',
      'flex-wrap': 'wrap-reverse',
    });
  });

  it('test_AS_062_wrap_and_direction_order_independent', () => {
    expect(expandDeclaration('flex-flow', 'nowrap column-reverse').decls).toEqual({
      'flex-wrap': 'nowrap',
      'flex-direction': 'column-reverse',
    });
  });

  it('test_AS_062_recognizes_flex_flow_as_shorthand', () => {
    expect(isShorthand('flex-flow')).toBe(true);
  });

  it('test_AS_062_global_keyword_is_dropped_with_warning', () => {
    const r = expandDeclaration('flex-flow', 'unset');
    expect(r.decls).toEqual({});
    expect(r.warning).toMatch(/dropped/);
  });
});

describe('AS-065: font shorthand expands style/weight/size/line-height/family', () => {
  it('test_AS_065_size_and_family_only', () => {
    expect(expandDeclaration('font', '14px Arial')).toEqual({
      decls: {
        'font-size': '14px',
        'font-family': 'Arial',
      },
    });
  });

  it('test_AS_065_size_slash_line_height_and_family', () => {
    expect(expandDeclaration('font', '14px/1.5 Arial, sans-serif')).toEqual({
      decls: {
        'font-size': '14px',
        'line-height': '1.5',
        'font-family': 'Arial, sans-serif',
      },
    });
  });

  it('test_AS_065_style_weight_size_line_height_family', () => {
    expect(expandDeclaration('font', 'italic bold 16px/1.4 Georgia, serif')).toEqual({
      decls: {
        'font-style': 'italic',
        'font-weight': 'bold',
        'font-size': '16px',
        'line-height': '1.4',
        'font-family': 'Georgia, serif',
      },
    });
  });

  it('test_AS_065_numeric_weight_and_normal_style', () => {
    expect(expandDeclaration('font', 'normal 700 12px "Helvetica Neue"')).toEqual({
      decls: {
        'font-style': 'normal',
        'font-weight': '700',
        'font-size': '12px',
        'font-family': '"Helvetica Neue"',
      },
    });
  });

  it('test_AS_065_size_only_no_family_is_warned_and_dropped_not_kept_as_shorthand', () => {
    // AS-069 / F051: the font fallback drops the value rather than
    // re-emitting the shorthand verbatim — Webflow rejects shorthand
    // declarations outright, so it must never come back as `font: ...`.
    const result = expandDeclaration('font', 'italic bold');
    expect(result.decls).toEqual({});
    expect(result.decls).not.toHaveProperty('font');
    expect(result.warning).toMatch(/could not expand/i);
  });

  it('test_AS_065_css4_numeric_weight_450', () => {
    // Regression for the M2 bug: the weight regex rejected CSS4 numeric
    // weights that aren't multiples of 100 (this repo's own design system
    // uses weight 450 for Inter normal text).
    expect(expandDeclaration('font', '450 14px Inter')).toEqual({
      decls: {
        'font-weight': '450',
        'font-size': '14px',
        'font-family': 'Inter',
      },
    });
  });

  it('test_AS_065_css4_numeric_weight_350_and_550', () => {
    expect(expandDeclaration('font', '350 14px Inter').decls['font-weight']).toBe('350');
    expect(expandDeclaration('font', '550 14px Inter').decls['font-weight']).toBe('550');
  });

  it('test_AS_065_global_keyword_on_font_is_dropped_with_warning', () => {
    const result = expandDeclaration('font', 'inherit');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });
});

describe('AS-066: list-style shorthand expands type/position/image', () => {
  it('test_AS_066_type_only', () => {
    expect(expandDeclaration('list-style', 'square')).toEqual({
      decls: { 'list-style-type': 'square' },
    });
  });

  it('test_AS_066_type_and_position', () => {
    expect(expandDeclaration('list-style', 'disc inside')).toEqual({
      decls: {
        'list-style-type': 'disc',
        'list-style-position': 'inside',
      },
    });
  });

  it('test_AS_066_type_position_and_url_image', () => {
    expect(expandDeclaration('list-style', 'square outside url(bullet.png)')).toEqual({
      decls: {
        'list-style-type': 'square',
        'list-style-position': 'outside',
        'list-style-image': 'url(bullet.png)',
      },
    });
  });

  it('test_AS_066_none_treated_as_type', () => {
    expect(expandDeclaration('list-style', 'none')).toEqual({
      decls: { 'list-style-type': 'none' },
    });
  });

  it('test_AS_066_global_keyword_on_list_style_is_dropped_with_warning', () => {
    const result = expandDeclaration('list-style', 'unset');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });
});

describe('AS-067: outline shorthand expands color/style/width', () => {
  it('test_AS_067_width_style_color', () => {
    expect(expandDeclaration('outline', '2px solid red')).toEqual({
      decls: {
        'outline-width': '2px',
        'outline-style': 'solid',
        'outline-color': 'red',
      },
    });
  });

  it('test_AS_067_style_only', () => {
    expect(expandDeclaration('outline', 'dotted')).toEqual({
      decls: { 'outline-style': 'dotted' },
    });
  });

  it('test_AS_067_named_width_and_style', () => {
    expect(expandDeclaration('outline', 'thick dashed')).toEqual({
      decls: {
        'outline-width': 'thick',
        'outline-style': 'dashed',
      },
    });
  });

  it('test_AS_067_color_keyword_and_style', () => {
    expect(expandDeclaration('outline', 'solid red')).toEqual({
      decls: {
        'outline-style': 'solid',
        'outline-color': 'red',
      },
    });
  });

  it('test_AS_067_bare_var_token_goes_to_color_not_width', () => {
    // Regression for the M2 bug: `outline: solid var(--accent)` must not
    // misclassify the var() token as a width.
    expect(expandDeclaration('outline', 'solid var(--accent)')).toEqual({
      decls: {
        'outline-style': 'solid',
        'outline-color': 'var(--accent)',
      },
    });
  });

  it('test_AS_067_global_keyword_on_outline_is_dropped_with_warning', () => {
    const result = expandDeclaration('outline', 'initial');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });
});

describe('isShorthand recognizes font, list-style, outline', () => {
  it('recognizes font, list-style, and outline as shorthands', () => {
    expect(isShorthand('font')).toBe(true);
    expect(isShorthand('list-style')).toBe(true);
    expect(isShorthand('outline')).toBe(true);
  });
});

describe('AS-055: border shorthand expands to width/style/color on all four sides', () => {
  it('test_AS_055_width_style_color', () => {
    expect(expandDeclaration('border', '1px solid red')).toEqual({
      decls: {
        'border-top-width': '1px',
        'border-top-style': 'solid',
        'border-top-color': 'red',
        'border-right-width': '1px',
        'border-right-style': 'solid',
        'border-right-color': 'red',
        'border-bottom-width': '1px',
        'border-bottom-style': 'solid',
        'border-bottom-color': 'red',
        'border-left-width': '1px',
        'border-left-style': 'solid',
        'border-left-color': 'red',
      },
    });
  });

  it('test_AS_055_style_only', () => {
    expect(expandDeclaration('border', 'dashed')).toEqual({
      decls: {
        'border-top-style': 'dashed',
        'border-right-style': 'dashed',
        'border-bottom-style': 'dashed',
        'border-left-style': 'dashed',
      },
    });
  });

  it('test_AS_055_color_style_width_in_declaration_order', () => {
    // parseBorderParts assigns tokens to the first unfilled matching slot in
    // declaration order: style keywords -> style, width-shaped tokens (a
    // unit-suffixed length or a named width keyword) -> width, anything
    // else -> color. A bare var() token has no unit, so it is not
    // width-shaped and falls into the color slot; "thin" is a named width
    // keyword and fills the width slot.
    expect(expandDeclaration('border', 'solid var(--accent) thin')).toEqual({
      decls: {
        'border-top-width': 'thin',
        'border-top-style': 'solid',
        'border-top-color': 'var(--accent)',
        'border-right-width': 'thin',
        'border-right-style': 'solid',
        'border-right-color': 'var(--accent)',
        'border-bottom-width': 'thin',
        'border-bottom-style': 'solid',
        'border-bottom-color': 'var(--accent)',
        'border-left-width': 'thin',
        'border-left-style': 'solid',
        'border-left-color': 'var(--accent)',
      },
    });
  });

  it('test_AS_055_bare_var_token_goes_to_color_not_width', () => {
    // Regression for the M2 bug: `border: solid var(--accent)` must not
    // misclassify the var() token as a width.
    expect(expandDeclaration('border', 'solid var(--accent)')).toEqual({
      decls: {
        'border-top-style': 'solid',
        'border-top-color': 'var(--accent)',
        'border-right-style': 'solid',
        'border-right-color': 'var(--accent)',
        'border-bottom-style': 'solid',
        'border-bottom-color': 'var(--accent)',
        'border-left-style': 'solid',
        'border-left-color': 'var(--accent)',
      },
    });
  });

  it('test_AS_055_bare_calc_token_goes_to_color_not_width', () => {
    expect(expandDeclaration('border', 'solid calc(1px + 1px)')).toEqual({
      decls: {
        'border-top-style': 'solid',
        'border-top-color': 'calc(1px + 1px)',
        'border-right-style': 'solid',
        'border-right-color': 'calc(1px + 1px)',
        'border-bottom-style': 'solid',
        'border-bottom-color': 'calc(1px + 1px)',
        'border-left-style': 'solid',
        'border-left-color': 'calc(1px + 1px)',
      },
    });
  });

  it('test_AS_055_global_keyword_on_border_is_dropped_with_warning', () => {
    const result = expandDeclaration('border', 'inherit');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });

  it('recognizes border as a shorthand', () => {
    expect(isShorthand('border')).toBe(true);
  });
});

describe('AS-056: border-top/right/bottom/left and border-width/style/color expand per side', () => {
  it('test_AS_056_border_top_expands_only_top_side', () => {
    expect(expandDeclaration('border-top', '2px dotted blue')).toEqual({
      decls: {
        'border-top-width': '2px',
        'border-top-style': 'dotted',
        'border-top-color': 'blue',
      },
    });
  });

  it('test_AS_056_border_right_expands_only_right_side', () => {
    expect(expandDeclaration('border-right', '1px solid green')).toEqual({
      decls: {
        'border-right-width': '1px',
        'border-right-style': 'solid',
        'border-right-color': 'green',
      },
    });
  });

  it('test_AS_056_border_bottom_expands_only_bottom_side', () => {
    expect(expandDeclaration('border-bottom', 'solid')).toEqual({
      decls: { 'border-bottom-style': 'solid' },
    });
  });

  it('test_AS_056_border_left_expands_only_left_side', () => {
    expect(expandDeclaration('border-left', '3px double')).toEqual({
      decls: {
        'border-left-width': '3px',
        'border-left-style': 'double',
      },
    });
  });

  it('test_AS_056_border_width_1to4_value_box_expansion', () => {
    expect(expandDeclaration('border-width', '1px 2px 3px 4px')).toEqual({
      decls: {
        'border-top-width': '1px',
        'border-right-width': '2px',
        'border-bottom-width': '3px',
        'border-left-width': '4px',
      },
    });
  });

  it('test_AS_056_border_style_1_value_applies_to_all_sides', () => {
    expect(expandDeclaration('border-style', 'dashed')).toEqual({
      decls: {
        'border-top-style': 'dashed',
        'border-right-style': 'dashed',
        'border-bottom-style': 'dashed',
        'border-left-style': 'dashed',
      },
    });
  });

  it('test_AS_056_border_color_2_value_vertical_horizontal', () => {
    expect(expandDeclaration('border-color', 'red blue')).toEqual({
      decls: {
        'border-top-color': 'red',
        'border-right-color': 'blue',
        'border-bottom-color': 'red',
        'border-left-color': 'blue',
      },
    });
  });

  it('test_AS_056_global_keyword_on_border_top_is_dropped_with_warning', () => {
    const result = expandDeclaration('border-top', 'unset');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });

  it('recognizes border-top/right/bottom/left and border-width/style/color as shorthands', () => {
    expect(isShorthand('border-top')).toBe(true);
    expect(isShorthand('border-right')).toBe(true);
    expect(isShorthand('border-bottom')).toBe(true);
    expect(isShorthand('border-left')).toBe(true);
    expect(isShorthand('border-width')).toBe(true);
    expect(isShorthand('border-style')).toBe(true);
    expect(isShorthand('border-color')).toBe(true);
  });
});

describe('AS-057: border-radius 1/2/3/4-value expansion preserves TL/TR/BR/BL corner order', () => {
  it('test_AS_057_one_value_applies_to_all_corners', () => {
    expect(expandDeclaration('border-radius', '4px')).toEqual({
      decls: {
        'border-top-left-radius': '4px',
        'border-top-right-radius': '4px',
        'border-bottom-right-radius': '4px',
        'border-bottom-left-radius': '4px',
      },
    });
  });

  it('test_AS_057_two_values_tl_br_then_tr_bl', () => {
    expect(expandDeclaration('border-radius', '4px 8px')).toEqual({
      decls: {
        'border-top-left-radius': '4px',
        'border-top-right-radius': '8px',
        'border-bottom-right-radius': '4px',
        'border-bottom-left-radius': '8px',
      },
    });
  });

  it('test_AS_057_three_values', () => {
    expect(expandDeclaration('border-radius', '4px 8px 12px')).toEqual({
      decls: {
        'border-top-left-radius': '4px',
        'border-top-right-radius': '8px',
        'border-bottom-right-radius': '12px',
        'border-bottom-left-radius': '8px',
      },
    });
  });

  it('test_AS_057_four_values_top_left_top_right_bottom_right_bottom_left', () => {
    expect(expandDeclaration('border-radius', '1px 2px 3px 4px')).toEqual({
      decls: {
        'border-top-left-radius': '1px',
        'border-top-right-radius': '2px',
        'border-bottom-right-radius': '3px',
        'border-bottom-left-radius': '4px',
      },
    });
  });

  it('test_AS_057_elliptical_radii_flattened_to_horizontal_with_warning', () => {
    const result = expandDeclaration('border-radius', '4px 8px / 2px 6px');
    expect(result.decls).toEqual({
      'border-top-left-radius': '4px',
      'border-top-right-radius': '8px',
      'border-bottom-right-radius': '4px',
      'border-bottom-left-radius': '8px',
    });
    expect(result.warning).toMatch(/elliptical/i);
  });

  it('test_AS_057_global_keyword_on_border_radius_is_dropped_with_warning', () => {
    const result = expandDeclaration('border-radius', 'inherit');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/dropped/i);
  });

  it('recognizes border-radius as a shorthand', () => {
    expect(isShorthand('border-radius')).toBe(true);
  });

  it('test_AS_057_calc_with_slash_is_not_mistaken_for_elliptical_split', () => {
    const result = expandDeclaration('border-radius', 'calc(100%/2)');
    expect(result.decls).toEqual({
      'border-top-left-radius': 'calc(100%/2)',
      'border-top-right-radius': 'calc(100%/2)',
      'border-bottom-right-radius': 'calc(100%/2)',
      'border-bottom-left-radius': 'calc(100%/2)',
    });
    expect(result.warning).toBeUndefined();
  });
});

describe('AS-055/AS-067: unitless zero is recognized as a width, and outline accepts style auto', () => {
  it('test_AS_055_border_unitless_zero_is_width_not_color', () => {
    expect(expandDeclaration('border', '0')).toEqual({
      decls: {
        'border-top-width': '0',
        'border-right-width': '0',
        'border-bottom-width': '0',
        'border-left-width': '0',
      },
    });
  });

  it('test_AS_067_outline_unitless_zero_is_width', () => {
    expect(expandDeclaration('outline', '0')).toEqual({
      decls: {
        'outline-width': '0',
      },
    });
  });

  it('test_AS_067_outline_style_auto_is_recognized', () => {
    const result = expandDeclaration('outline', '2px auto -webkit-focus-ring-color');
    expect(result.decls['outline-style']).toBe('auto');
  });
});

describe('FU-M2-16: box helper never emits undefined values', () => {
  it('test_FU_M2_16_margin_empty_value_never_produces_undefined_decls', () => {
    const result = expandDeclaration('margin', '');
    expect(Object.values(result.decls).every((v) => v !== undefined)).toBe(true);
  });
});

describe('AS-063: transition unknown token does not overwrite an already-set transition-property', () => {
  it('test_AS_063_var_token_after_property_does_not_overwrite_property', () => {
    const result = expandDeclaration('transition', 'opacity .2s var(--ease)');
    expect(result.decls['transition-property']).toBe('opacity');
    expect(result.warning).toMatch(/var\(--ease\)/);
  });
});

describe('AS-065: font slash normalization, weight 1000, small-caps, and system-font keywords', () => {
  it('test_AS_065_slash_with_surrounding_spaces_is_normalized', () => {
    expect(expandDeclaration('font', '16px / 1.5 Arial')).toEqual({
      decls: {
        'font-size': '16px',
        'line-height': '1.5',
        'font-family': 'Arial',
      },
    });
  });

  it('test_AS_065_weight_1000_is_accepted', () => {
    expect(expandDeclaration('font', '1000 14px Inter')).toEqual({
      decls: {
        'font-weight': '1000',
        'font-size': '14px',
        'font-family': 'Inter',
      },
    });
  });

  it('test_AS_065_small_caps_sets_font_variant', () => {
    const result = expandDeclaration('font', 'small-caps 16px Inter');
    expect(result.decls).toMatchObject({ 'font-variant': 'small-caps' });
  });

  it('test_AS_065_system_font_keyword_is_dropped_with_warning', () => {
    const result = expandDeclaration('font', 'caption');
    expect(result.decls).toEqual({});
    expect(result.warning).toBeTruthy();
  });
});

describe('AS-069: expandDeclaration dispatches to the correct expander by property name', () => {
  it('test_AS_069_dispatches_box_rule_for_margin_padding_inset', () => {
    expect(expandDeclaration('margin', '1px').decls).toHaveProperty('margin-top');
    expect(expandDeclaration('padding', '1px').decls).toHaveProperty('padding-top');
    expect(expandDeclaration('inset', '1px').decls).toHaveProperty('top');
  });

  it('test_AS_069_dispatches_border_handler_for_border_family', () => {
    expect(expandDeclaration('border', '1px solid red').decls).toHaveProperty('border-top-width');
    expect(expandDeclaration('border-top', '1px solid red').decls).toHaveProperty('border-top-width');
    expect(expandDeclaration('border-width', '1px').decls).toHaveProperty('border-top-width');
    expect(expandDeclaration('border-radius', '4px').decls).toHaveProperty('border-top-left-radius');
  });

  it('test_AS_069_dispatches_gap_overflow_place_handler', () => {
    expect(expandDeclaration('gap', '1px').decls).toHaveProperty('row-gap');
    expect(expandDeclaration('overflow', 'hidden').decls).toHaveProperty('overflow-x');
    expect(expandDeclaration('place-items', 'center').decls).toHaveProperty('align-items');
  });

  it('test_AS_069_dispatches_flex_handler', () => {
    expect(expandDeclaration('flex', 'auto').decls).toHaveProperty('flex-grow');
    expect(expandDeclaration('flex-flow', 'wrap').decls).toHaveProperty('flex-wrap');
  });

  it('test_AS_069_dispatches_transition_handler', () => {
    expect(expandDeclaration('transition', 'opacity .2s').decls).toHaveProperty('transition-property');
  });

  it('test_AS_069_dispatches_font_list_outline_handler', () => {
    expect(expandDeclaration('font', '14px Arial').decls).toHaveProperty('font-size');
    expect(expandDeclaration('list-style', 'square').decls).toHaveProperty('list-style-type');
    expect(expandDeclaration('outline', '2px solid red').decls).toHaveProperty('outline-width');
  });

  it('test_AS_069_unknown_property_falls_through_to_pass_through_default', () => {
    expect(expandDeclaration('color', 'blue')).toEqual({ decls: { color: 'blue' } });
    expect(expandDeclaration('display', 'flex')).toEqual({ decls: { display: 'flex' } });
  });

  it('test_AS_069_prop_matching_is_case_insensitive_and_trims_whitespace', () => {
    expect(expandDeclaration(' MARGIN ', '1px').decls).toHaveProperty('margin-top');
  });
});

describe('isShorthand returns true for every known shorthand, false for longhands', () => {
  it('test_isShorthand_true_for_all_known_shorthands', () => {
    for (const prop of [
      'margin', 'padding', 'inset', 'border', 'border-top', 'border-right', 'border-bottom',
      'border-left', 'border-width', 'border-style', 'border-color', 'border-radius',
      'font', 'list-style', 'transition', 'outline', 'overflow',
      'gap', 'flex', 'flex-flow', 'place-items', 'place-content', 'place-self',
    ]) {
      expect(isShorthand(prop)).toBe(true);
    }
  });

  it('test_isShorthand_false_for_known_longhands', () => {
    for (const prop of [
      'margin-top', 'padding-left', 'border-top-color', 'border-top-width', 'border-top-style',
      'flex-grow', 'flex-shrink', 'flex-basis', 'transition-property', 'transition-duration',
      'font-size', 'font-family', 'list-style-type', 'outline-width', 'row-gap', 'column-gap',
      'overflow-x', 'align-items', 'justify-content', 'color', 'display', 'top',
    ]) {
      expect(isShorthand(prop)).toBe(false);
    }
  });
});

describe('AS-069: unimplemented shorthands are warned-and-dropped, never emitted verbatim', () => {
  it('test_AS_069_background_animation_grid_gridtemplate_gridarea_are_warned_and_dropped', () => {
    for (const prop of ['background', 'animation', 'grid', 'grid-template', 'grid-area']) {
      const result = expandDeclaration(prop, 'some-value-that-should-never-appear');
      expect(result.decls).toEqual({});
      expect(result.warning).toMatch(/not supported/i);
    }
  });

  it('test_AS_069_shorthand_vocabulary_whitelist_recognizes_all_missing_properties', () => {
    // Independent, hardcoded corpus of the F057 shorthand vocabulary. This
    // list is NOT derived from SHORTHANDS in longhand.ts — if a property is
    // ever removed from that set, this test must fail.
    const corpus = [
      'text-decoration',
      'columns',
      'mask',
      'border-image',
      'offset',
      'text-emphasis',
      'scroll-margin',
      'scroll-padding',
      'grid-column',
      'grid-row',
      'all',
      'container',
      'text-wrap',
      'margin-inline',
      'margin-block',
      'padding-inline',
      'padding-block',
      'inset-inline',
      'inset-block',
      'border-inline',
      'border-block',
    ];
    for (const prop of corpus) {
      expect(isShorthand(prop)).toBe(true);
    }
  });

  it('test_AS_069_grid_gap_expands_to_row_gap_and_column_gap', () => {
    expect(expandDeclaration('grid-gap', '10px')).toEqual({
      decls: { 'row-gap': '10px', 'column-gap': '10px' },
    });
    expect(expandDeclaration('grid-gap', '10px 20px')).toEqual({
      decls: { 'row-gap': '10px', 'column-gap': '20px' },
    });
  });

  it('test_AS_069_font_fallback_drops_unexpandable_value_instead_of_reemitting_shorthand', () => {
    const result = expandDeclaration('font', 'not a valid font shorthand @@@');
    // Whatever the fallback path does, it must never hand back the raw
    // shorthand property/value pair verbatim.
    expect(result.decls).not.toHaveProperty('font');
  });

  it('test_AS_069_default_branch_never_emits_a_shorthand_key_verbatim', () => {
    for (const prop of ['background', 'animation', 'grid', 'grid-template', 'grid-area', 'grid-gap']) {
      const result = expandDeclaration(prop, 'anything');
      expect(Object.keys(result.decls)).not.toContain(prop);
    }
  });

  it('test_AS_069_independent_vocabulary_every_known_shorthand_expands_to_empty_decls_with_warning', () => {
    // Independent corpus sourced directly from the css-shorthand-properties
    // package (not from SHORTHANDS in longhand.ts). Every property it
    // considers a shorthand must never be emitted verbatim by
    // expandDeclaration — either it has a real expander, it is on the
    // PASS_THROUGH allow-list (Webflow accepts it natively), or it falls
    // into the warn-and-drop default branch.
    for (const prop of Object.keys(shorthandProperties)) {
      if (PASS_THROUGH.has(prop)) continue;
      const result = expandDeclaration(prop, 'test');
      expect(Object.keys(result.decls)).not.toContain(prop);
    }
  });

  it('test_AS_069_unsupported_shorthands_from_independent_vocabulary_are_dropped_with_warning', () => {
    // Properties the independent vocabulary considers shorthand but which
    // longhand.ts has no dedicated expander for must warn-and-drop, unless
    // they are on the PASS_THROUGH allow-list.
    const IMPLEMENTED = new Set([
      'margin', 'padding', 'inset', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
      'border-width', 'border-style', 'border-color', 'border-radius', 'gap', 'grid-gap', 'overflow',
      'place-items', 'place-content', 'place-self', 'transition', 'flex', 'flex-flow', 'outline',
      'list-style', 'font',
    ]);
    const unimplemented = Object.keys(shorthandProperties).filter((p) => !IMPLEMENTED.has(p) && !PASS_THROUGH.has(p));
    for (const prop of unimplemented) {
      const result = expandDeclaration(prop, 'test');
      expect(result.decls).toEqual({});
      expect(result.warning).toBeTruthy();
    }
  });

  it('test_AS_069_vendor_prefixed_shorthands_are_dropped_not_passed_through', () => {
    for (const prop of ['-webkit-transition', '-webkit-animation', '-webkit-border-radius']) {
      const result = expandDeclaration(prop, 'test');
      expect(result.decls).toEqual({});
      expect(result.warning).toBeTruthy();
    }
  });

  it('AS-069: PASS_THROUGH longhands survive expandDeclaration', () => {
    for (const prop of ['background-position', 'background-size', 'grid-row', 'grid-column']) {
      const { decls, warning } = expandDeclaration(prop, 'center');
      expect(decls).toEqual({ [prop]: 'center' });
      expect(warning).toBeUndefined();
    }
  });

  it('AS-069: EXTRA_SHORTHANDS are warned-and-dropped', () => {
    for (const prop of ['overscroll-behavior', 'border-inline-start', 'border-inline-end',
                         'border-block-start', 'border-block-end', '-webkit-box-shadow']) {
      const { decls, warning } = expandDeclaration(prop, 'test');
      expect(decls).toEqual({});
      expect(warning).toMatch(/shorthand/);
    }
  });
});

describe('AS-062: flex-flow unrecognized token does not overwrite flex-direction', () => {
  it('test_AS_062_unknown_token_is_warned_and_does_not_overwrite_flex_direction', () => {
    const result = expandDeclaration('flex-flow', 'row wrap extra');
    expect(result.decls).toEqual({ 'flex-wrap': 'wrap', 'flex-direction': 'row' });
    expect(result.warning).toMatch(/extra/);
  });
});

describe('AS-066: list-style unrecognized token does not overwrite list-style-type', () => {
  it('test_AS_066_unknown_token_is_warned_and_does_not_overwrite_list_style_type', () => {
    const result = expandDeclaration('list-style', 'disc foo bar');
    expect(result.decls).toEqual({ 'list-style-type': 'disc' });
    expect(result.warning).toMatch(/unrecognized/);
  });
});

describe('AS-058/AS-059/AS-060/AS-061/AS-063: empty values are warned-and-dropped, never emitted as undefined', () => {
  it('test_AS_058_gap_empty_value_is_warned_and_dropped', () => {
    const result = expandDeclaration('gap', '');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/empty value skipped/);
  });

  it('test_AS_059_overflow_empty_value_is_warned_and_dropped', () => {
    const result = expandDeclaration('overflow', '');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/empty value skipped/);
  });

  it('test_AS_060_place_items_content_self_empty_value_is_warned_and_dropped', () => {
    for (const prop of ['place-items', 'place-content', 'place-self']) {
      const result = expandDeclaration(prop, '');
      expect(result.decls).toEqual({});
      expect(result.warning).toMatch(/empty value skipped/);
    }
  });

  it('test_AS_061_flex_empty_value_is_warned_and_dropped', () => {
    const result = expandDeclaration('flex', '');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/empty value skipped/);
  });

  it('test_AS_063_transition_empty_value_is_warned_and_dropped', () => {
    const result = expandDeclaration('transition', '');
    expect(result.decls).toEqual({});
    expect(result.warning).toMatch(/empty value skipped/);
  });
});
