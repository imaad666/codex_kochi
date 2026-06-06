import { useCallback, useEffect, useMemo, useRef } from "react";

export default function CodeEditor({
  value = "",
  onChange,
  onSave,
  readOnly = false,
  placeholder = "// Open a repo or run a swarm to load files",
  diagnostic = null,
  errorLine = null,
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave?.();
        return;
      }
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
    [readOnly, value, onChange, onSave]
  );

  const errorBanner =
    diagnostic && !diagnostic.ok ? (
      <div className="code-editor-issue" role="alert">
        {diagnostic.line ? `Line ${diagnostic.line}: ` : ""}
        {diagnostic.message}
      </div>
    ) : null;

  return (
    <div className={`code-editor-wrap ${readOnly ? "readonly" : ""}`}>
      {errorBanner}
      <div className={`code-editor ${readOnly ? "readonly" : ""}`}>
        <div className="code-editor-gutter crt-scroll" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => (
            <div
              key={index}
              className={`code-editor-ln ${errorLine === index + 1 ? "error-line" : ""}`}
            >
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
          aria-invalid={diagnostic && !diagnostic.ok ? "true" : "false"}
        />
      </div>
    </div>
  );
}

export const codeEditorCss = `
  .code-editor-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    position: relative;
  }
  .code-editor-issue {
    flex-shrink: 0;
    padding: 5px 10px;
    font-size: 12px;
    line-height: 1.35;
    color: #ffb0b0;
    background: #2a1212;
    border-bottom: 1px solid #ff777766;
    font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .code-editor {
    display: flex;
    flex: 1;
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
  .code-editor-ln.error-line {
    color: #ff9999;
    background: #3a1818;
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
  .editor-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    font-size: 11px;
    color: #7a9494;
    background: #0c1414;
    border-bottom: 1px solid #1e3030;
    min-height: 26px;
    flex-shrink: 0;
  }
  .editor-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #a8c8c8;
    font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .editor-dirty {
    color: #fff06a;
    font-weight: 600;
    flex-shrink: 0;
  }
  .editor-swarm-error {
    color: #ff9999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 42%;
    flex-shrink: 1;
  }
  .editor-hint {
    flex-shrink: 0;
    color: #5a7878;
    font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .save-flash {
    position: absolute;
    top: 36px;
    right: 14px;
    z-index: 12;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    color: #0a1010;
    background: #e7ff4a;
    box-shadow: 0 0 18px #e7ff4a88, 0 4px 16px #00000066;
    animation: save-flash-in 0.18s ease-out, save-flash-out 0.35s ease-in 1.65s forwards;
    pointer-events: none;
    font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif;
  }
  @keyframes save-flash-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes save-flash-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  .tab.dirty::after {
    content: "●";
    margin-left: 4px;
    color: #fff06a;
    font-size: 9px;
    vertical-align: super;
  }
`;
