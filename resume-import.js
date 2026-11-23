const pdfBase = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
const wordScript = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.3/mammoth.browser.min.js';
let wordLibrary;

function loadWordLibrary() {
  if (wordLibrary) return wordLibrary;
  wordLibrary = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = wordScript;
    script.crossOrigin = 'anonymous';
    script.onload = () => (window.mammoth ? resolve(window.mammoth) : reject(new Error('Word reader unavailable')));
    script.onerror = () => reject(new Error('Word reader unavailable'));
    document.head.append(script);
  }).catch(error => {
    wordLibrary = undefined;
    throw error;
  });
  return wordLibrary;
}

async function readPdf(data) {
  const pdf = await import(pdfBase + 'legacy/build/pdf.min.mjs');
  pdf.GlobalWorkerOptions.workerSrc = pdfBase + 'legacy/build/pdf.worker.min.mjs';
  const task = pdf.getDocument({
    data,
    isEvalSupported: false,
    stopAtErrors: true,
    cMapUrl: pdfBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: pdfBase + 'standard_fonts/',
  });
  try {
    const document = await task.promise;
    if (document.numPages > 50) throw new RangeError('Choose a PDF with 50 pages or fewer.');
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const { items } = await page.getTextContent();
      let text = '';
      let previousY;
      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        if (previousY !== undefined && Math.abs(y - previousY) > 3 && !text.endsWith('\n')) text += '\n';
        text += item.str + (item.hasEOL ? '\n' : ' ');
        previousY = y;
      }
      pages.push(text);
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

export function initResumeImport({ input, status, field, matchButton, dropzone }) {
  let attempt = 0;

  async function handleFile(file) {
    if (!file) return;
    const current = ++attempt;
    const original = field.value;
    const extension = file.name.split('.').at(-1).toLowerCase();
    matchButton.disabled = true;
    status.textContent = 'Reading ' + file.name + '…';
    try {
      if (extension !== 'pdf' && extension !== 'docx') throw new RangeError('Choose a PDF or Word (.docx) file.');
      if (!file.size || file.size > 10 * 1024 * 1024) throw new RangeError('Choose a non-empty file up to 10 MB.');
      const buffer = await file.arrayBuffer();
      const result =
        extension === 'pdf'
          ? await readPdf(buffer)
          : (await (await loadWordLibrary()).extractRawText({ arrayBuffer: buffer })).value;
      if (current !== attempt) return;
      const text = result.replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) {
        throw new RangeError(
          extension === 'pdf'
            ? 'This PDF has no selectable text. Use a text-based PDF or Word file, or paste the résumé text.'
            : 'This Word file has no readable résumé text.'
        );
      }
      if (field.value !== original) {
        status.textContent = 'Your edits were kept. Select the file again to replace the text.';
        return;
      }
      field.value = text.slice(0, field.maxLength);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const sizeKb = Math.max(1, Math.round(file.size / 1024));
      status.textContent =
        text.length > field.maxLength
          ? `Imported first ${field.maxLength.toLocaleString()} chars from ${file.name} (${sizeKb} KB). Review and click Match jobs.`
          : `Imported ${file.name} (${sizeKb} KB · ${wordCount} words). Click Match jobs to rank roles.`;
    } catch (error) {
      if (current !== attempt) return;
      status.textContent =
        error instanceof RangeError
          ? error.message
          : error.name === 'PasswordException'
            ? 'This PDF is password-protected. Choose an unlocked copy.'
            : 'Could not read this file. Try another PDF or Word (.docx) file, or paste the résumé text.';
    } finally {
      if (current === attempt) matchButton.disabled = false;
    }
  }

  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    handleFile(file);
  });

  if (dropzone) {
    dropzone.addEventListener('dragover', event => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', event => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      const file = event.dataTransfer?.files?.[0];
      handleFile(file);
    });
  }

  return {
    clear() {
      attempt++;
      input.value = '';
      status.textContent = '';
      matchButton.disabled = false;
    },
  };
}
