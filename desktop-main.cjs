const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { mkdirSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('Laya Decision Studio');
const profileArg = process.argv.find(arg => arg.startsWith('--profile='));
const profile = profileArg ? path.resolve(profileArg.slice('--profile='.length)) : process.env.LAYA_PROFILE ? path.resolve(process.env.LAYA_PROFILE) : path.join(__dirname, '.laya-browser', 'native');
mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
app.enableSandbox();

let win, server, origin, exitApproved = false, closeInProgress = false, saveInProgress = false, stoppingServer;
let shutdownPromise,shutdownComplete=false,pendingClose=false,pendingForce=false,uiReady=false;
const usedModels=new Set();
const importLocal = name => import(pathToFileURL(path.join(__dirname,name)).href);
function stopServer() {
  if (!stoppingServer) stoppingServer = new Promise(resolve => {
    if (!server) return resolve();
    server.closeAllConnections(); server.close(resolve);
  });
  return stoppingServer;
}
function shutdown() {
  if(!shutdownPromise)shutdownPromise=(async()=>{
    console.log('Stopping Laya UI server...');
    await stopServer();
    const {unloadSessionModels}=await importLocal('ollama-session.mjs');
    await unloadSessionModels(usedModels);
  })().catch(error=>console.error(`Shutdown cleanup: ${error.message}`)).finally(()=>{
    shutdownComplete=true;console.log('Laya closed. UI server stopped.');
  });
  return shutdownPromise;
}
function closeFromLauncher(force=false) {
  if(!uiReady){pendingClose=true;pendingForce ||= force;return;}
  if(!win||win.isDestroyed())return;
  if(force) {
    exitApproved=true;
    // Force-close must also work when the renderer cannot answer JavaScript.
    void win.webContents.executeJavaScript('window.layaClearConversation()').catch(()=>{});
    win.destroy();
  } else if(win&&!win.isDestroyed()) {win.show();win.focus();win.close();}
}
process.on('message',message=>{
  if(message?.type==='laya-close')closeFromLauncher();
  if(message?.type==='laya-force-close')closeFromLauncher(true);
});
function allowed(event) { return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url.startsWith(`${origin}/`); }
async function snapshot(abort = false) {
  const data = await win.webContents.executeJavaScript(abort ? 'window.layaPrepareToClose()' : 'window.layaSessionData()');
  const { normalizeSession } = await importLocal('public/session.js');
  return normalizeSession(data);
}
async function saveFiles(value, formats) {
  if (saveInProgress) return { saved: false, error: 'A save is already in progress.' };
  if (!Array.isArray(formats) || !formats.length || formats.length > 2 || new Set(formats).size !== formats.length || formats.some(f => !['json','xlsx'].includes(f))) throw new Error('Choose JSON, Excel, or both.');
  saveInProgress = true;
  const paths = [];
  try {
    const { normalizeSession } = await importLocal('public/session.js');
    const session = normalizeSession(value), stamp = new Date().toISOString().replace(/[:.]/g,'-');
    for (const format of formats) {
      const selection = await dialog.showSaveDialog(win, {
        title: format === 'json' ? 'Save JSON conversation' : 'Save Excel report',
        defaultPath: path.join(app.getPath('documents'), `laya-conversation-${stamp}.${format}`),
        filters: [{ name: format === 'json' ? 'JSON conversation' : 'Excel workbook', extensions: [format] }],
        properties: ['showOverwriteConfirmation'],
      });
      if (selection.canceled || !selection.filePath) return { saved: false, cancelled: true, paths };
      const buffer = format === 'json' ? Buffer.from(JSON.stringify(session,null,2),'utf8') : await (await importLocal('workbook.mjs')).exportWorkbook(session);
      await writeFile(selection.filePath, buffer); paths.push(selection.filePath);
    }
    return { saved: true, paths };
  } finally { saveInProgress = false; }
}

async function requestClose() {
  if (closeInProgress || saveInProgress || !win || win.isDestroyed()) return;
  closeInProgress = true;
  try {
    await snapshot();
    const choice = await dialog.showMessageBox(win, {
      type: 'question', title: 'Save before closing?', message: 'Save this conversation before closing Laya?',
      detail: 'JSON can be loaded to continue later. Excel saves a readable report. Discard clears the conversation. Cancel keeps Laya open.',
      buttons: ['Save JSON', 'Save Excel', 'Save Both', 'Discard', 'Cancel'], defaultId: 2, cancelId: 4, noLink: true,
    });
    if (choice.response === 4) return;
    if (choice.response !== 3) {
      const formats = choice.response === 0 ? ['json'] : choice.response === 1 ? ['xlsx'] : ['json','xlsx'];
      const outcome = await saveFiles(await snapshot(true), formats);
      if (!outcome.saved) return;
    }
    await win.webContents.executeJavaScript('window.layaClearConversation()');
    exitApproved = true; win.close();
  } catch (error) {
    if (win && !win.isDestroyed()) await dialog.showMessageBox(win, { type:'error',title:'Conversation was not saved',message:'Laya will stay open.',detail:error.message,buttons:['OK'] });
  } finally { closeInProgress = false; }
}

if (!app.requestSingleInstanceLock()) {
  console.log('The Laya window is already running.'); app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    const { startApp } = await importLocal('server.mjs');
    const running = await startApp({port:Number(process.env.PORT || 3210),reuse:false,
      appOptions:{onModelUsed:model=>usedModels.add(model)},
      log:message=>console.log(message.replace('Press Ctrl+C to stop.','Close the Laya window to stop.')),
    }); server = running.server; origin = running.url;
    win = new BrowserWindow({ width:1440,height:1000,minWidth:760,minHeight:600,show:false,title:'Laya Decision Studio',backgroundColor:'#f7f7fb',
      webPreferences:{ preload:path.join(__dirname,'desktop-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false },
    });
    win.setMenuBarVisibility(false);
    win.on('close', event => { if (!exitApproved) { event.preventDefault(); void requestClose(); } });
    win.webContents.setWindowOpenHandler(({url}) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return {action:'deny'};
    });
    win.webContents.on('will-navigate', (event,url) => { if (!url.startsWith(`${origin}/`)) event.preventDefault(); });
    ipcMain.handle('laya:save', async (event,data,formats) => {
      if (!allowed(event)) throw new Error('Only the Laya window can save files.');
      return saveFiles(data,formats);
    });
    ipcMain.on('laya:close', event => { if (allowed(event)) win.close(); });
    win.once('ready-to-show', () => win.show());
    await win.loadURL(origin);
    uiReady=true;win.show();win.focus();
    console.log('Laya ready. Closing the window offers Save JSON, Save Excel, Save Both, Discard, or Cancel.');
    if(pendingClose)closeFromLauncher(pendingForce);
  }).catch(async error => { dialog.showErrorBox('Laya could not start',error.message); await shutdown(); app.exit(1); });
  app.on('before-quit', event => {
    if(shutdownComplete)return;
    event.preventDefault();
    if(win&&!win.isDestroyed()&&!exitApproved)win.close();
    else void shutdown().then(()=>app.quit());
  });
  app.on('window-all-closed', () => { void shutdown().then(() => app.quit()); });
}
