import { fireEvent, within } from '@testing-library/react';

/**
 * Picks an option in a `SelectField`/`Dropdown`: opens it, then taps the option whose value or label is `option`.
 * Stands in for `userEvent.selectOptions`, which only works on a native select.
 */
export function chooseOption(control: HTMLElement, option: string) {
  if (control.getAttribute('aria-expanded') !== 'true') fireEvent.click(control);
  const menu = document.getElementById(control.getAttribute('aria-controls') ?? '');
  if (!menu) throw new Error('The dropdown did not open.');
  const byValue = Array.from(menu.querySelectorAll('[role="option"]')).find((item) => item.getAttribute('data-value') === option);
  fireEvent.click(byValue ?? within(menu).getByRole('option', { name: option }));
}

/** The value a dropdown currently holds (what `toHaveValue` gave on a native select). */
export function selectedValue(control: HTMLElement) {
  return control.getAttribute('data-value');
}

/** The labels of the options, opening the dropdown to read them and closing it again. */
export function optionLabels(control: HTMLElement) {
  const wasOpen = control.getAttribute('aria-expanded') === 'true';
  if (!wasOpen) fireEvent.click(control);
  const menu = document.getElementById(control.getAttribute('aria-controls') ?? '');
  const labels = menu ? within(menu).queryAllByRole('option').map((item) => item.textContent ?? '') : [];
  if (!wasOpen) fireEvent.click(control);
  return labels;
}
