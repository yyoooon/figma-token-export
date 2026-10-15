import { extractFigma } from './extract';
import { transform } from './transform';

interface UIMessage {
  type: string;
  settings?: unknown;
}

figma.showUI(__html__, { width: 360, height: 560 });

figma.ui.onmessage = async (msg: UIMessage) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type === 'load-settings') {
    const settings = await figma.clientStorage.getAsync('settings');
    // 파일 이름을 프로젝트 이름 기본값으로 함께 전달(UI에서 항상 덮어씀).
    figma.ui.postMessage({ type: 'settings', settings: settings ?? {}, fileName: figma.root.name });
    return;
  }
  if (msg.type === 'save-settings') {
    await figma.clientStorage.setAsync('settings', msg.settings);
    return;
  }
  if (msg.type === 'get-filename') {
    figma.ui.postMessage({ type: 'filename', fileName: figma.root.name });
    return;
  }
  if (msg.type === 'export') {
    try {
      const raw = await extractFigma();
      const tokens = transform(raw);
      figma.ui.postMessage({ type: 'result', tokens });
    } catch (err) {
      // 추출·변환 중 예외(깨진 별칭 등)를 UI로 전달 — 안 하면 UI가 "토큰 추출 중…"에서 멈춘다.
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: 'error', message });
    }
  }
};
