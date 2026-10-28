// 交付輸出檔：分享面板（spec §8.4）→ 不支援就下載；?test=1 時交給測試掛鉤。

/** @returns {Promise<'shared'|'downloaded'|'cancelled'|'needsTap'|'test'>} */
export async function deliver(file) {
  const test = new URLSearchParams(location.search).get('test');
  if (test !== null && test !== 'share') { // ?test=share：測試分享面板的拒絕與取消（navigator.share 由測試替換）
    window.__aio ??= { outputs: [] };
    window.__aio.outputs ??= [];
    window.__aio.outputs.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return 'test';
  }
  let canShare = false;
  try { canShare = !!navigator.canShare?.({ files: [file] }); } catch { /* 不支援 */ }
  if (canShare) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';     // 使用者按取消：不算錯誤
      if (e?.name === 'NotAllowedError') return 'needsTap'; // 處理太久，使用者手勢過期：改顯示按鈕讓使用者再按一次
    }
  }
  download(file);
  return 'downloaded';
}

/** 使用者按下「點這裡分享／儲存」時直接呼叫（此時有新的使用者手勢） */
export async function shareNow(file) {
  let canShare = false;
  try { canShare = !!navigator.canShare?.({ files: [file] }); } catch { /* 不支援 */ }
  if (canShare) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      if (e?.name === 'NotAllowedError') return 'needsTap';
    }
  }
  download(file);
  return 'downloaded';
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
