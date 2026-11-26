import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { CustomFieldDef } from '../types/saas.ts';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function CustomFieldInputs({
  entityType,
  values,
  onChange,
}: {
  entityType: CustomFieldDef['entityType'];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [fields, setFields] = useState<CustomFieldDef[]>([]);

  useEffect(() => {
    api
      .getCustomFields(entityType)
      .then((res) => setFields(res.fields))
      .catch(() => setFields([]));
  }, [entityType]);

  if (fields.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-[var(--av-border-subtle)] pt-3">
      <div className="text-xs font-semibold text-[var(--av-text)]">
        Workspace Custom Fields
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => {
          const val = values[field.fieldKey] ?? '';
          const update = (nextVal: string) =>
            onChange({ ...values, [field.fieldKey]: nextVal });

          return (
            <div key={field.id}>
              <label className="block text-[11px] font-medium text-[var(--av-text-subtle)] mb-1">
                {field.label}
                {field.required ? ' *' : ''}
              </label>
              {field.fieldType === 'select' ? (
                <select
                  required={field.required}
                  value={val}
                  onChange={(e) => update(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">Select...</option>
                  {(field.options || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={
                    field.fieldType === 'number'
                      ? 'number'
                      : field.fieldType === 'date'
                        ? 'date'
                        : 'text'
                  }
                  required={field.required}
                  value={val}
                  onChange={(e) => update(e.target.value)}
                  className={INPUT_CLASS}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CustomFieldValuesDisplay({
  entityType,
  entityId,
}: {
  entityType: CustomFieldDef['entityType'];
  entityId: string;
}) {
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!entityId) return;
    Promise.all([
      api.getCustomFields(entityType),
      api.getCustomFieldValues(entityType, entityId),
    ])
      .then(([fRes, vRes]) => {
        setFields(fRes.fields);
        setValues(vRes.values);
      })
      .catch(() => {
        setFields([]);
        setValues({});
      });
  }, [entityType, entityId]);

  const populated = fields.filter((f) => values[f.fieldKey]);
  if (populated.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/35 p-3.5 space-y-2">
      <div className="text-xs font-semibold text-[var(--av-text)]">
        Custom Attributes
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {populated.map((f) => (
          <div key={f.id}>
            <span className="text-[var(--av-text-subtle)]">{f.label}: </span>
            <span className="font-medium text-[var(--av-text)]">{values[f.fieldKey]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
