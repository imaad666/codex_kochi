import { useCallback, useEffect, useMemo, useRef } from "react";

export default function CodeEditor({
  value = "",
  onChange,
  readOnly = false,
  placeholder = "// Open a repo or run a swarm to load files",
}) {
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);

  const lineCount = useMemo(() => {
    const text = String(value || "");
    return Math.max(text.split("\n").length, 1);
  }, [value]);

  const syncScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  const handleKeyDown = useCallback(
    (event) => {
      if (readOnly) return;
      if (event.key !== "Tab") return;
      event.preventDefault();
      const field = textareaRef.current;
      if (!field) return;
      const start = field.selectionStart;
      const end = field.selectionEnd;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange?.(next);
      requestAnimationFrame(() => {
        field.selectionStart = start + 2;
        field.selectionEnd = start + 2;
      });
    },
    [readOnly, value, onChange]
  );

  return (
    <div className={`code-editor ${readOnly ? "readonly" : ""}`}>
      <div className="code-editor-gutter crt-scroll" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index} className="code-editor-ln">
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="code-editor-input crt-scroll"
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        wrap="off"
        onChange={(event) => onChange?.(event.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="Code editor"
      />
    </div>
  );
}

export const codeEditorCss = `
  .code-editor {
    display: flex;
    height: 100%;
    min-height: 0;
    background: #0a1010;
    border-top: 1px solid #2a4848;
    font-family: "VT323", "SF Mono", "Fira Code", ui-monospace, monospace;
    font-size: 15px;
    line-height: 1.45;
  }
  .code-editor-gutter {
    flex-shrink: 0;
    width: 44px;
    padding: 8px 6px 8px 0;
    text-align: right;
    color: #4a6868;
    user-select: none;
    overflow: hidden;
    border-right: 1px solid #1e3030;
    background: #080c0c;
  }
  .code-editor-ln {
    height: 1.45em;
    padding-right: 4px;
  }
  .code-editor-input {
    flex: 1;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 8px 12px;
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: #e7ff4a;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
  }
  .code-editor-input::placeholder {
    color: #5a7878;
  }
  .code-editor.readonly .code-editor-input {
    color: #c7da2e;
  }
  .code-editor:not(.readonly) .code-editor-input:focus {
    box-shadow: inset 0 0 0 1px #3a787866;
  }
`;
