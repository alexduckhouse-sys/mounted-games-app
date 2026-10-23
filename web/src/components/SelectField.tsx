import { Children, Fragment, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dropdown, type DropdownOption } from './Dropdown';

/** What `onChange` receives: just enough of a change event for `event.target.value`. */
export interface SelectChange { target: { value: string }; currentTarget: { value: string } }

export interface SelectFieldProps {
  value?: string | number;
  /** For an uncontrolled field (the field remembers what was picked). */
  defaultValue?: string | number;
  onChange?: (event: SelectChange) => void;
  /** Give the options here, or as `<option>` and `<optgroup>` children as on a native select. */
  options?: DropdownOption[];
  children?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  id?: string;
  title?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  /** Styles the button (the visible field). */
  className?: string;
  /** Styles the box around the button, for layout. */
  wrapperClassName?: string;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

interface OptionProps { value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }

/** Reads `<option>`, `<optgroup>` and fragments the way a native select would. */
export function optionsFromChildren(children: ReactNode, group?: string, out: DropdownOption[] = []): DropdownOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<OptionProps>;
    if (element.type === Fragment) optionsFromChildren(element.props.children, group, out);
    else if (element.type === 'optgroup') optionsFromChildren(element.props.children, element.props.label, out);
    else if (element.type === 'option') {
      const label = textOf(element.props.children);
      out.push({ value: String(element.props.value ?? label), label, disabled: element.props.disabled, group });
    }
  });
  return out;
}

/**
 * The app's own replacement for a form `<select>`: a field-styled button that opens a listbox
 * (see `Dropdown`). Options come from `options` or from `<option>`/`<optgroup>` children, and `onChange`
 * gets an object with `target.value`, so existing handlers carry over.
 */
export function SelectField({
  value, defaultValue, onChange, options, children, placeholder, disabled, invalid, required, id, title, name,
  className, wrapperClassName, ...aria
}: SelectFieldProps) {
  const [own, setOwn] = useState(defaultValue == null ? '' : String(defaultValue));
  const current = value === undefined ? own : String(value);
  const list = options ?? optionsFromChildren(children);
  const chosen = list.find((option) => option.value === current);
  const isInvalid = invalid ?? (aria['aria-invalid'] === true || aria['aria-invalid'] === 'true');
  // A blank option reads as the placeholder, as it does on a native select.
  const text = chosen?.label ?? '';
  const blank = current === '';

  const change = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.({ target: { value: next }, currentTarget: { value: next } });
  };

  return (
    <div className={`relative min-w-0 ${wrapperClassName ?? ''}`}>
      <Dropdown
        id={id}
        label={aria['aria-label']}
        labelledBy={aria['aria-labelledby']}
        value={current}
        options={list}
        onChange={change}
        disabled={disabled}
        invalid={isInvalid}
        title={title}
        buttonClassName={`mg-select ${className ?? ''}`}
        menuClassName="mg-select-menu"
      >
        <span className={`mg-select-value ${blank ? 'mg-select-placeholder' : ''}`}>{text || placeholder || '\u00a0'}</span>
        <ChevronDown aria-hidden="true" className="mg-select-caret h-4 w-4" />
      </Dropdown>
      {name && <input type="hidden" name={name} value={current} />}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          readOnly
          value={current}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        />
      )}
    </div>
  );
}
