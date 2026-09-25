const MAX_BYTES = 10 * 1024 * 1024;

export async function readPhoto(file) {
  if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) {
    throw new Error('请选择 PNG、JPEG 或 WebP 照片');
  }
  if (!file.size || file.size > MAX_BYTES) throw new Error('每张照片不能超过 10 MB');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('无法读取这张照片'); });
  bitmap.close();
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('照片读取失败，请重新选择'));
    reader.readAsDataURL(file);
  });
}

export function createPhotoInput({onSubmit,onOpen,onClose,notice}) {
  const $ = id => document.getElementById(id);
  const panel = $('photo-dialog'), submit = $('photo-submit');
  const values = {front:null,side:null}, versions = {front:0,side:0};
  let opened = false, podId = null, previousFocus = null;
  const sync = () => { submit.disabled = !values.front || !values.side; };
  function close() {
    if (!opened) return;
    opened = false; panel.hidden = true;
    for (const name of ['front','side']) {
      versions[name]++; values[name] = null;
      $('photo-'+name).value = '';
      $('photo-'+name+'-preview').removeAttribute?.('src');
      $('photo-'+name+'-preview').hidden = true;
      $('photo-'+name+'-name').textContent = '';
    }
    sync(); onClose(); previousFocus?.focus?.();
  }
  for (const name of ['front','side']) {
    $('photo-'+name).addEventListener('change', async event => {
      const version = ++versions[name];
      const file = event.target.files?.[0];
      values[name] = null; sync();
      $('photo-error').textContent = '';
      $('photo-'+name+'-preview').hidden = true;
      $('photo-'+name+'-name').textContent = file?.name || '';
      if (!file) return;
      try {
        const data = await readPhoto(file);
        if (!opened || version !== versions[name]) return;
        values[name] = data;
        $('photo-'+name+'-preview').src = data;
        $('photo-'+name+'-preview').hidden = false;
      } catch(error) {
        if (opened && version === versions[name]) $('photo-error').textContent = error.message;
      }
      sync();
    });
  }
  $('photo-close').addEventListener('click',close);
  $('photo-cancel').addEventListener('click',close);
  submit.addEventListener('click',() => {
    if (!opened || submit.disabled) return;
    const images = {a:values.front,b:values.side};
    const id = podId;
    close();
    if (!onSubmit(id,images)) notice('舱体暂不可用，照片尚未提交');
  });
  panel.addEventListener('keydown',event => {
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.code === 'Tab') {
      const controls = [...panel.querySelectorAll('button:not(:disabled),input,select')];
      const first=controls[0],last=controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  panel.hidden = true; sync();
  return {
    get open(){return opened;},
    show(id) {
      if (opened) return;
      podId=id; opened=true; previousFocus=document.activeElement;
      $('photo-title').textContent='创意融合 / GENESIS '+String(id+1).padStart(2,'0');
      $('photo-error').textContent='';
      panel.hidden=false; onOpen(); $('photo-front').focus?.();
    },
    close,
  };
}
