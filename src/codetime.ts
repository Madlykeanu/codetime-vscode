import * as os from 'os';
import process from 'process';
import got from 'got';


import * as vscode from 'vscode';
import { v4 } from 'uuid';

import osName from 'os-name'
import * as events from './events'
import { getDurationText } from './getDurationText'
import { getGitCurrentBranch, getGitOriginUrl } from './utils'

export class CodeTime {
  osName = osName()
  private lastActivityTime: number = Date.now();

  setToken() {
    vscode.window
      .showInputBox({
        password: true,
        placeHolder: 'CodeTime: Input Your Token (from: codetime.dev)',
      })
      .then((token) => {
        if (token && this.isToken(token)) {
          this.state.update('token', token)
          this.token = token
          this.getCurrentDuration(true)
        }
        else {
          vscode.window.showErrorMessage('CodeTime: Token validation failed')
          this.statusBar.text = '$(clock) CodeTime: Cannot Get Token'
          this.statusBar.tooltip = 'Enter Token'
          this.statusBar.command = 'codetime.getToken'
          this.token = ''
        }
      })
  }

  private statusBar: vscode.StatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
  )

  public disposable!: vscode.Disposable
  state: vscode.Memento
  client: any;
  userId: number
  token: string = ''
  inter!: NodeJS.Timeout
  session: string
  constructor(state: vscode.Memento) {
    this.state = state
    this.userId = this.getUserId()
    this.initSetToken()
    this.client = got.extend({
      prefixUrl: vscode.workspace.getConfiguration('codetime').serverEntrypoint as string,
      responseType: 'json',
      headers: {
        'User-Agent': 'CodeTime Client',
      },
      hooks: {
        beforeRequest: [
          (options: any) => {
            if (options.headers)
              options.headers.token = this.token
          },
        ],
      },
    } as any);
    this.session = v4()
    this.init()
  }

  getUserId(): number {
    return 2
  }

  isToken(token: string) {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      token,
    )
  }

  initSetToken() {
    const stateToken = this.state.get<string>('token')
    const envToken = process.env.CODETIME_TOKEN
    this.token = envToken || (stateToken || '')
    if (this.token === '')
      this.setToken()
  }

  private init(): void {
    this.statusBar.text = '$(clock) CodeTime: Initializing...'
    this.statusBar.show()
    this.setupEventListeners()
    this.getCurrentDuration()
    this.inter = setInterval(() => {
      const timeoutTime = vscode.workspace.getConfiguration('codetime').get<number>('timeoutTime', 600000); // 600000 is the default value
      if (Date.now() - this.lastActivityTime > timeoutTime) {
        // User is inactive for more than the configured timeout time, handle accordingly
        // For example, update the status bar to indicate inactivity
      } else {
        // User is active, continue logging time or perform other actions
        this.getCurrentDuration();
      }
    }, 60000); // Check every minute
  }

  private setupEventListeners(): void {
    // subscribe to selection change and editor activation events
    const events: vscode.Disposable[] = []
    vscode.window.onDidChangeActiveTextEditor(this.onEditor, this, events)
    vscode.window.onDidChangeWindowState(this.onFocus, this, events)
    vscode.workspace.onDidSaveTextDocument(this.onSave, this, events)
    vscode.workspace.onDidChangeTextDocument(this.onEdit, this, events)
    vscode.workspace.onDidCreateFiles(this.onCreate, this, events)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codetime'))
        this.getCurrentDuration()
    })
    this.disposable = vscode.Disposable.from(...events)
  }

  private onEdit(e: vscode.TextDocumentChangeEvent) {
    this.lastActivityTime = Date.now();
    let eventName = events.FILE_EDITED
    if (e.contentChanges.length === 1
      && /\r\n|\n|\r/.test(e.contentChanges[0].text)) {
      eventName = events.FILE_ADDED_LINE
      this.onChange(eventName)
    }
    else if (Math.random() > 0.9) { this.onChange(eventName) }
  }

  private onEditor(_e: vscode.TextEditor | undefined) {
    this.lastActivityTime = Date.now();
    this.onChange(events.ACTIVATE_FILE_CHANGED)
  }

  private onFocus(_e: vscode.WindowState) {
    this.lastActivityTime = Date.now();
    this.onChange(events.EDITOR_CHANGED)
  }

  private onCreate() {
    this.lastActivityTime = Date.now();
    this.onChange(events.FILE_CREATED)
  }

  private onSave(_e: vscode.TextDocument) {
    this.lastActivityTime = Date.now();
    this.onChange(events.FILE_SAVED)
  }

  platfromVersion = os.release()
  platfromArch = os.arch()
  private onChange(eventName = 'unknown') {
    const editor = vscode.window.activeTextEditor
    const workspaceName = vscode.workspace.name
    const workspaceRoot = vscode.workspace.workspaceFolders
    if (workspaceRoot && editor) {
      const doc = editor.document
      if (doc) {
        const lang: string = doc.languageId
        const absoluteFilePath = doc.fileName
        let relativeFilePath: string = vscode.workspace.asRelativePath(
          absoluteFilePath,
        )
        if (relativeFilePath === absoluteFilePath)
          relativeFilePath = '[other workspace]'

        if (relativeFilePath) {
          const time: number = Date.now()
          const origin = getGitOriginUrl()
          const branch = getGitCurrentBranch()
          const data = {
            project: workspaceName,
            language: lang,
            relativeFile: relativeFilePath,
            absoluteFile: absoluteFilePath,
            editor: 'VSCode',
            platform: this.osName,
            eventTime: time,
            eventType: eventName,
            platformArch: this.platfromArch,
            plugin: 'VSCode',
            gitOrigin: origin,
            gitBranch: branch,
          }
          // Post data
          this.client.post(`eventLog`, { json: data }).catch((e: { response: { statusCode: number } }) => {
            // eslint-disable-next-line no-console
            console.info(e)
            // TODO: Append Data To Local
            // this.appendDataToLocal(data);
          })
        }
      }
    }
  }

  private getCurrentDuration(showSuccess = false) {
    // Check for inactivity
    const timeoutTime = vscode.workspace.getConfiguration('codetime').get<number>('timeoutTime', 600000); // 600000 ms = 10 minutes
    if (Date.now() - this.lastActivityTime > timeoutTime) { // Use the configurable timeout time
      // Consider user inactive, do not log time
      return;
    }
    const key = vscode.workspace.getConfiguration('codetime').statusBarInfo
    if (this.token === '') {
      this.statusBar.text = '$(clock) CodeTime: Without Token'
      this.statusBar.tooltip = 'Enter Token'
      this.statusBar.command = 'codetime.getToken'
      return
    }
    this.statusBar.command = 'codetime.toDashboard'
    this.statusBar.tooltip = 'CodeTime: Head to the dashboard for statistics'
    let minutes = 60 * 24
    switch (key) {
      case 'today': {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
        const hours = now.getHours()
        minutes = now.getMinutes()
        minutes += hours * 60
        break
      }
      case 'total' : {
        minutes = 60 * 24 * 365 * 100
        break
      }
      case '24h': {
        minutes = 60 * 24
        break
      }
      default: {
        minutes = 60 * 24 * 365 * 100
        break
      }
    }
    this.client.get(`user/minutes?minutes=${minutes}`).then((res: { body: { minutes: number } }) => {
      const { minutes } = res.body;
      this.statusBar.text = `$(watch) ${getDurationText(minutes * 60 * 1000)}`;
      if (showSuccess)
        vscode.window.showInformationMessage('CodeTime: Token validation succeeded');
    });
  }

  public codeTimeInStatBar() {
    vscode.window
      .showQuickPick(
        ['Total code time', '24h code time', 'Today code time'],
        {},
      )
      .then((v) => {
        let key = 'total'
        switch (v) {
          case '24h code time':
            key = '24h'
            break
          case 'Today code time':
            key = 'today'
            break
          default:
            break
        }
        vscode.workspace
          .getConfiguration('codetime')
          .update('statusBarInfo', key, true)
          .then(() => this.getCurrentDuration())
      })
  }

  public dispose() {
    this.statusBar.dispose()
    this.disposable.dispose()
    clearInterval(this.inter)
  }
}
