// ファイルの書き出しと選択（S1-28）。JSON のエクスポートとインポートで使う

// 文字列をファイルとしてダウンロードさせる
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // ダウンロードが始まるまで URL を残す
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// 隠したファイル選択。open() で選択の画面を開き、選んだファイルを onFile に渡す
export function createFilePicker(
  host: HTMLElement,
  accept: string,
  onFile: (file: File) => void,
): { open(): void; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.hidden = true;
  input.dataset.testid = 'import-file';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    // 同じファイルをもう一度選んでも change が起きるように空にする
    input.value = '';
    if (file !== undefined) onFile(file);
  });
  host.append(input);
  return {
    open() {
      input.click();
    },
    input,
  };
}
