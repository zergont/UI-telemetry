import { useState, useRef, useEffect, useCallback } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";

interface InlineEditProps {
  value: string;
  placeholder?: string;
  onSave: (value: string) => Promise<void>;
  className?: string;
  inputClassName?: string;
}

export default function InlineEdit({
  value,
  placeholder = "Без названия",
  onSave,
  className = "",
  inputClassName = "",
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      // revert on error
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

  const handleCancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          disabled={saving}
          className={`bg-transparent border-b-2 border-primary outline-none font-inherit ${inputClassName}`}
          placeholder={placeholder}
        />
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSave}
              className="text-green-500 hover:text-green-400 transition-colors"
              title="Сохранить (Enter)"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCancel}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Отмена (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </span>
    );
  }

  return (
    <span className={`group inline-flex items-center gap-1.5 ${className}`}>
      <span>{value || placeholder}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setEditing(true);
        }}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
        title="Переименовать"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
