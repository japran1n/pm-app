import { describe, expect, it } from 'vitest';
import {
  isWebflowSupportedProp,
  isWebflowSupportedValue,
  partitionByWebflowSupport,
  WEBFLOW_SUPPORTED_PROPS,
} from './webflow-properties';

describe('webflow-properties: whitelist of Webflow clipboard style-type props', () => {
  it('test_M7_known_designer_props_are_supported', () => {
    for (const prop of ['display', 'color', 'padding-top', 'grid-row-gap', 'transition', 'box-shadow']) {
      expect(isWebflowSupportedProp(prop)).toBe(true);
    }
  });

  it('test_M7_unknown_props_are_not_supported', () => {
    for (const prop of [
      'background-attachment', 'background-position', 'background-size', 'not-a-real-prop',
    ]) {
      expect(isWebflowSupportedProp(prop)).toBe(false);
    }
  });

  it('test_M7_lookup_is_case_insensitive_and_trims_whitespace', () => {
    expect(isWebflowSupportedProp('  Color  ')).toBe(true);
    expect(isWebflowSupportedProp('DISPLAY')).toBe(true);
  });

  it('test_M7_partition_splits_supported_from_unsupported', () => {
    const { supported, unsupported } = partitionByWebflowSupport({
      color: 'red',
      'background-position': 'center',
      'padding-top': '4px',
      'background-attachment': 'fixed',
    });
    expect(supported).toEqual({ color: 'red', 'padding-top': '4px' });
    expect(unsupported).toEqual({ 'background-position': 'center', 'background-attachment': 'fixed' });
  });

  it('test_M7_partition_of_all-supported_decls_leaves_unsupported_empty', () => {
    const { supported, unsupported } = partitionByWebflowSupport({ color: 'red', opacity: '0.5' });
    expect(supported).toEqual({ color: 'red', opacity: '0.5' });
    expect(unsupported).toEqual({});
  });

  it('test_M7_whitelist_is_a_real_Set_not_accidentally_empty', () => {
    expect(WEBFLOW_SUPPORTED_PROPS.size).toBeGreaterThan(50);
  });

  it('test_M7_text-decoration_is_in_whitelist', () => {
    // text-decoration has a style-type entry in Webflow's buildStyleBlock
    // lookup table; it belongs in styleLess, not the CSS embed.
    expect(isWebflowSupportedProp('text-decoration')).toBe(true);
    const { supported, unsupported } = partitionByWebflowSupport({ 'text-decoration': 'none', color: 'red' });
    expect(supported).toEqual({ 'text-decoration': 'none', color: 'red' });
    expect(unsupported).toEqual({});
  });
});

describe('webflow-properties: isWebflowSupportedValue() — value-level validation', () => {
  it('test_M7_display_inline-flex_is_supported', () => {
    expect(isWebflowSupportedValue('display', 'inline-flex')).toBe(true);
  });

  it('test_M7_display_table_is_unsupported', () => {
    expect(isWebflowSupportedValue('display', 'table')).toBe(false);
  });

  it('test_M7_display_flex_is_supported', () => {
    expect(isWebflowSupportedValue('display', 'flex')).toBe(true);
  });

  it('test_M7_display_other_safe_values_are_supported', () => {
    for (const v of ['block', 'inline-block', 'inline', 'grid', 'inline-grid', 'none']) {
      expect(isWebflowSupportedValue('display', v)).toBe(true);
    }
  });

  it('test_M7_margin-top_auto_is_supported_no_restriction', () => {
    expect(isWebflowSupportedValue('margin-top', 'auto')).toBe(true);
  });

  it('test_M7_margin-top_unit_value_is_supported', () => {
    expect(isWebflowSupportedValue('margin-top', '1rem')).toBe(true);
  });

  it('test_M7_flex-basis_auto_is_supported', () => {
    expect(isWebflowSupportedValue('flex-basis', 'auto')).toBe(true);
  });

  it('test_M7_flex-basis_zero_is_supported', () => {
    expect(isWebflowSupportedValue('flex-basis', '0')).toBe(true);
  });

  it('test_M7_flex-basis_100px_is_unsupported', () => {
    // Only "auto", "0%", "0" are in the Webflow flex-basis style-type set.
    expect(isWebflowSupportedValue('flex-basis', '100px')).toBe(false);
  });

  it('test_M7_unrestricted_props_accept_any_value_including_auto', () => {
    for (const prop of ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'top', 'right', 'bottom', 'left', 'padding-left']) {
      expect(isWebflowSupportedValue(prop, 'auto')).toBe(true);
      expect(isWebflowSupportedValue(prop, '10px')).toBe(true);
    }
  });

  it('test_M7_align-items_center_is_supported', () => {
    expect(isWebflowSupportedValue('align-items', 'center')).toBe(true);
  });

  it('test_M7_text-decoration_none_is_supported', () => {
    expect(isWebflowSupportedValue('text-decoration', 'none')).toBe(true);
  });

  it('test_M7_text-decoration_blink_is_unsupported', () => {
    expect(isWebflowSupportedValue('text-decoration', 'blink')).toBe(false);
  });

  it('test_M7_unrelated_property_values_pass_through', () => {
    expect(isWebflowSupportedValue('color', 'red')).toBe(true);
    expect(isWebflowSupportedValue('opacity', '0.5')).toBe(true);
    expect(isWebflowSupportedValue('flex-grow', '1')).toBe(true);
    expect(isWebflowSupportedValue('flex-shrink', '0')).toBe(true);
  });
});
