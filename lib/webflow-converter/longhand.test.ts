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

  it('test_AS_065_size_only_no_family_is_kept_as_shorthand_with_warning', () => {
    const result = expandDeclaration('font', 'italic bold');
    expect(result.decls).toEqual({ font: 'italic bold' });
    expect(result.warning).toMatch(/could not expand/i);
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
    // declaration order: style keywords -> style, width-shaped tokens ->
    // width, anything else -> color. A var() token is width-shaped, so it
    // fills the width slot here, matching the reference prototype exactly.
    expect(expandDeclaration('border', 'solid var(--accent) thin')).toEqual({
      decls: {
        'border-top-width': 'var(--accent)',
        'border-top-style': 'solid',
        'border-top-color': 'thin',
        'border-right-width': 'var(--accent)',
        'border-right-style': 'solid',
        'border-right-color': 'thin',
        'border-bottom-width': 'var(--accent)',
        'border-bottom-style': 'solid',
        'border-bottom-color': 'thin',
        'border-left-width': 'var(--accent)',
        'border-left-style': 'solid',
        'border-left-color': 'thin',
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
});
