"use client";

import { useState } from "react";

type MultiSelectTagsProps = {
  label: string;
  name: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
};

export default function MultiSelectTags({
  label,
  name,
  options,
  selected,
  onChange,
}: MultiSelectTagsProps) {
  const [customOptions, setCustomOptions] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const allOptions = [
    ...new Set([...options, ...customOptions, ...selected]),
  ].sort((left, right) => left.localeCompare(right));

  function toggleTag(tag: string) {
    onChange(
      selected.includes(tag)
        ? selected.filter((item) => item !== tag)
        : [...selected, tag],
    );
  }

  function addTag() {
    const tag = newTag.trim();
    if (!tag || tag.length > 80) return;
    const existing = allOptions.find(
      (option) => option.toLowerCase() === tag.toLowerCase(),
    );
    const value = existing ?? tag;
    if (!existing) setCustomOptions((current) => [...current, value]);
    if (!selected.includes(value)) onChange([...selected, value]);
    setNewTag("");
  }

  return (
    <fieldset className="trade-tag-picker">
      <legend>{label}</legend>
      <details className="trade-tag-dropdown">
        <summary>
          {selected.length > 0
            ? `${selected.length} selected`
            : `Select ${label.toLowerCase()}`}
        </summary>
        <div className="trade-tag-options">
          {allOptions.map((tag) => (
            <label key={tag}>
              <input
                checked={selected.includes(tag)}
                name={name}
                onChange={() => toggleTag(tag)}
                type="checkbox"
                value={tag}
              />
              <span>{tag}</span>
            </label>
          ))}
        </div>
      </details>
      {selected.length > 0 ? (
        <div className="trade-tag-chips" aria-label={`Selected ${label.toLowerCase()}`}>
          {selected.map((tag) => (
            <button
              aria-label={`Remove ${tag}`}
              key={tag}
              onClick={() => toggleTag(tag)}
              type="button"
            >
              {tag} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="trade-tag-add">
        <input
          aria-label={`Add custom ${label.toLowerCase()}`}
          maxLength={80}
          onChange={(event) => setNewTag(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder={`Add custom ${label.toLowerCase()}`}
          value={newTag}
        />
        <button disabled={!newTag.trim()} onClick={addTag} type="button">
          Add
        </button>
      </div>
    </fieldset>
  );
}
