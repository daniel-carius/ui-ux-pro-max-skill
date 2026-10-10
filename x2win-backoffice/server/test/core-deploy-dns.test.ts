// Regressão r3-process-resilience-and-restart-3 (e r3-runtime-resilience-nginx-upstream): o nginx do deploy
// resolvia "api" uma única vez, ao carregar a configuração (`proxy_pass http://api:3333;`, sem resolver). Com o
// contêiner "api" parado o web nem subia ([emerg] host not found in upstream), e com a API recriada em outro IP o
// painel ficava em 502 até alguém reiniciar o web. Agora deploy/nginx.conf usa `resolver 127.0.0.11 valid=10s` e
// `proxy_pass $x2w_api;` (nome resolvido em tempo de execução pelo DNS do Docker).
//
// Este arquivo afirma:
//  A. com o contêiner "api" parado (fora do DNS do Docker), o web sobe e serve o painel e o redirecionamento 80->443
//     (/api responde 502 enquanto isso);
//  B. depois que o contêiner "api" é recriado com outro IP, /api volta a responder sem reiniciar o web.
//
// Como reproduz, sem Docker e sem tocar em nada do host: um processo filho roda num namespace de rede e de montagem
// próprios (unshare -m -n). Lá dentro:
//  - um DNS falso em 127.0.0.11:53 faz o papel do DNS embutido do Docker ("api" -> IP atual, NXDOMAIN se parado);
//    /etc/resolv.conf e /etc/hosts do namespace ficam como os de um contêiner do compose;
//  - /etc/nginx do namespace recebe deploy/nginx.conf como conf.d/default.conf (exatamente como o Dockerfile.web copia)
//    e deploy/security-headers.conf em snippets/; certificado autoassinado em certs/;
//  - a "api" é a app real (createTestApp de test/helpers.ts), ouvindo em 172.30.0.3:3333 e, recriada, em 172.30.0.5:3333.
// Única diferença do arquivo do deploy: com um nginx < 1.25.1 (o do sistema), a linha `http2 on;` é retirada.
//
// Precisa: binário do nginx, root, `unshare`, `ip`, `mount`, `openssl`. Sem isso, o arquivo é pulado.
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(SERVER_DIR, '..')
const TSX = path.join(SERVER_DIR, 'node_modules', '.bin', 'tsx')
const HELPERS = path.join(SERVER_DIR, 'test/helpers.ts')
const NGINX = ['/usr/sbin/nginx', '/usr/bin/nginx', '/usr/local/sbin/nginx'].find((p) => existsSync(p))
const CAN_RUN =
  !!NGINX &&
  process.getuid?.() === 0 &&
  spawnSync('unshare', ['-m', '-n', 'true']).status === 0 &&
  spawnSync('openssl', ['version']).status === 0

// Roda como root dentro do namespace próprio. Imprime um JSON com o que observou.
const SCENARIO = String.raw`
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process'
import dgram from 'node:dgram'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

// (a variável de ambiente NGINX é reservada pelo próprio nginx: herança de sockets)
const { X2W_NGINX: NGINX, ROOT, WORK, HELPERS } = process.env
const { createTestApp } = await import(HELPERS)
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString()
// assíncrono: o DNS falso roda neste mesmo processo e precisa do laço de eventos livre para responder
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stdout, stderr })))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// rede do "host docker": loopback + dois endereços da rede bridge do compose
sh('ip', ['link', 'set', 'lo', 'up'])
sh('ip', ['addr', 'add', '172.30.0.3/32', 'dev', 'lo'])
sh('ip', ['addr', 'add', '172.30.0.5/32', 'dev', 'lo'])

// DNS embutido do Docker (127.0.0.11): "api" -> IP do contêiner em execução; parado -> NXDOMAIN
let apiIp = null
const dnsLog = []
const dns = dgram.createSocket('udp4')
dns.on('message', (msg, rinfo) => {
  let off = 12
  const labels = []
  while (msg[off] !== 0) { labels.push(msg.subarray(off + 1, off + 1 + msg[off]).toString()); off += msg[off] + 1 }
  off += 1
  const qtype = msg.readUInt16BE(off)
  off += 4
  const name = labels.join('.').toLowerCase()
  dnsLog.push(name + '/' + qtype + ' -> ' + (name === 'api' ? apiIp : 'nx'))
  const known = name === 'api' && apiIp !== null
  const answers = []
  if (known && qtype === 1) {
    const rr = Buffer.alloc(16)
    rr.writeUInt16BE(0xc00c, 0); rr.writeUInt16BE(1, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(600, 6); rr.writeUInt16BE(4, 10)
    apiIp.split('.').forEach((p, i) => rr.writeUInt8(Number(p), 12 + i))
    answers.push(rr)
  }
  const hdr = Buffer.alloc(12)
  hdr.writeUInt16BE(msg.readUInt16BE(0), 0)
  hdr.writeUInt16BE(0x8180 | (known ? 0 : 3), 2)
  hdr.writeUInt16BE(1, 4)
  hdr.writeUInt16BE(answers.length, 6)
  dns.send(Buffer.concat([hdr, msg.subarray(12, off), ...answers]), rinfo.port, rinfo.address)
})
await new Promise((r) => dns.bind(53, '127.0.0.11', r))

// sistema de arquivos do contêiner web (só neste namespace de montagem)
const etc = path.join(WORK, 'etc-nginx')
for (const d of ['conf.d', 'snippets', 'certs']) fs.mkdirSync(path.join(etc, d), { recursive: true })
fs.mkdirSync(path.join(WORK, 'tmp'), { recursive: true, mode: 0o777 })
fs.mkdirSync(path.join(WORK, 'html'), { recursive: true })
fs.writeFileSync(path.join(WORK, 'html', 'index.html'), '<!doctype html><title>painel</title>')
fs.copyFileSync('/etc/nginx/mime.types', path.join(etc, 'mime.types'))
// nginx.conf principal da imagem nginx:1.27-alpine (sem resolver), com caminhos de log/pid/temp locais
fs.writeFileSync(path.join(etc, 'nginx.conf'), [
  'worker_processes 1;',
  'pid ' + WORK + '/nginx.pid;',
  'events { worker_connections 1024; }',
  'http {',
  '  include /etc/nginx/mime.types;',
  '  default_type application/octet-stream;',
  '  access_log off;',
  '  client_body_temp_path ' + WORK + '/tmp; proxy_temp_path ' + WORK + '/tmp; fastcgi_temp_path ' + WORK + '/tmp;',
  '  uwsgi_temp_path ' + WORK + '/tmp; scgi_temp_path ' + WORK + '/tmp;',
  '  sendfile on;',
  '  keepalive_timeout 65;',
  '  include /etc/nginx/conf.d/*.conf;',
  '}',
].join('\n'))
const version = String(spawnSync(NGINX, ['-v']).stderr)
const [maj, min, pat] = (version.match(/nginx\/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
out.nginxVersion = maj + '.' + min + '.' + pat
let site = fs.readFileSync(path.join(ROOT, 'deploy', 'nginx.conf'), 'utf8')
const oldNginx = maj === 1 && (min < 25 || (min === 25 && pat < 1))
if (oldNginx) site = site.replace(/^\s*http2 on;\n/m, '')
out.siteDiffersFromDeployOnlyByHttp2Line = oldNginx
out.proxyPassLine = (site.match(/^\s*proxy_pass .*$/m) ?? [''])[0].trim()
out.resolverLine = (site.match(/^\s*resolver\s.*$/m) ?? [''])[0].trim()
fs.writeFileSync(path.join(etc, 'conf.d', 'default.conf'), site)
fs.copyFileSync(path.join(ROOT, 'deploy', 'security-headers.conf'), path.join(etc, 'snippets', 'x2win-security-headers.conf'))
sh('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=painel.x2win.test',
  '-keyout', path.join(etc, 'certs', 'privkey.pem'), '-out', path.join(etc, 'certs', 'fullchain.pem')])
fs.writeFileSync(path.join(WORK, 'resolv.conf'), 'nameserver 127.0.0.11\noptions ndots:0\n')
fs.writeFileSync(path.join(WORK, 'hosts'), '127.0.0.1\tlocalhost\n172.30.0.9\tweb\n')
sh('mount', ['--bind', etc, '/etc/nginx'])
sh('mount', ['--bind', path.join(WORK, 'html'), '/usr/share/nginx/html'])
sh('mount', ['--bind', path.join(WORK, 'resolv.conf'), '/etc/resolv.conf'])
sh('mount', ['--bind', path.join(WORK, 'hosts'), '/etc/hosts'])
const errorLog = path.join(WORK, 'error.log')

function req(url, opts = {}) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? https : http
    const r = mod.request(url, { rejectUnauthorized: false, timeout: 5000, ...opts }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve(res.statusCode + ' ' + body.replace(/\s+/g, ' ').slice(0, 60)))
    })
    r.on('error', (e) => resolve('ERR ' + e.code))
    r.on('timeout', () => r.destroy(new Error('timeout')))
    r.end()
  })
}
function startNginx() {
  const ng = spawn(NGINX, ['-c', '/etc/nginx/nginx.conf', '-e', errorLog, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  ng.stderr.on('data', (d) => (stderr += d))
  const exited = new Promise((r) => ng.on('exit', (code) => r(code)))
  return { ng, exited, stderr: () => stderr }
}
async function startApi(ip) {
  const app = await createTestApp()
  await app.listen({ host: ip, port: 3333 })
  return app
}

// ---- A: "docker compose restart web" com o contêiner api parado (ex.: API caiu) --------------------------------
apiIp = null
{
  const t = await run(NGINX, ['-t', '-c', '/etc/nginx/nginx.conf', '-e', errorLog])
  out.A_nginx_t = t.status === 0 ? 'ok' : 'exit ' + t.status + ': ' + String(t.stderr).trim().split('\n').find((l) => l.includes('emerg'))
}
{
  const n = startNginx()
  const code = await Promise.race([n.exited, sleep(2000).then(() => 'still running')])
  out.A_nginx_start = code === 'still running' ? 'running' : 'exited with code ' + code + ': ' + n.stderr().trim()
  out.A_panel_https = await req('https://127.0.0.1/')
  out.A_redirect_http = await req('http://127.0.0.1/')
  out.A_api_while_down = await req('https://127.0.0.1/api/health')
  if (code === 'still running') { n.ng.kill('SIGTERM'); await n.exited }
}

// ---- B: api recriado com IP novo ("docker compose up -d --build" de uma mudança só na API) ----------------------
apiIp = '172.30.0.3'
let api = await startApi('172.30.0.3')
const n = startNginx()
for (let i = 0; i < 50 && (await req('https://127.0.0.1/')).startsWith('ERR'); i++) await sleep(100)
out.B1_before_recreate = await req('https://127.0.0.1/api/health')
await api.close() // contêiner antigo removido
apiIp = '172.30.0.5' // contêiner novo, IP novo no DNS do Docker
api = await startApi('172.30.0.5')
out.B2_getent_hosts_api = String((await run('getent', ['hosts', 'api'])).stdout).trim() // = docker compose exec web getent hosts api
out.B2_direct_by_name = await req('http://api:3333/api/health') // quem resolve de novo chega na API nova
// o painel tenta de novo por 20 s (mais que qualquer cache razoável de DNS, ex.: resolver ... valid=10s)
out.B3_after_recreate = []
const dnsBefore = dnsLog.length
const t0 = Date.now()
let last = ''
while (Date.now() - t0 < 20_000) {
  last = await req('https://127.0.0.1/api/health')
  if (out.B3_after_recreate.length < 3) out.B3_after_recreate.push(last)
  if (last.startsWith('200 ')) break
  await sleep(500)
}
out.B3_last_after_20s_or_recovery = last
out.B3_seconds_until_recovery = last.startsWith('200 ') ? Math.round((Date.now() - t0) / 1000) : null
out.B3_dns_queries_by_nginx_during_requests = dnsLog.length - dnsBefore
out.B3_panel_static = await req('https://127.0.0.1/')
out.B3_error_log = fs.readFileSync(errorLog, 'utf8').split('\n').filter((l) => l.includes('upstream:')).map((l) => l.replace(/^.*?\[error\]\s*\d+#\d+:\s*\*\d+\s*/, '')).slice(-2)
// só reler a configuração (o que um "docker compose restart web" faz) volta a chegar na API
n.ng.kill('SIGHUP')
await sleep(800)
out.B4_after_nginx_reload = await req('https://127.0.0.1/api/health')
n.ng.kill('SIGTERM')
await n.exited
await api.close()
dns.close()
out.dnsQueries = dnsLog
console.log('@@RESULT@@' + JSON.stringify(out))
process.exit(0)
`

describe.skipIf(!CAN_RUN)('deploy/nginx.conf com o DNS do Docker: a API parada ou recriada não derruba o web', () => {
  let result: Record<string, any>
  let work = ''

  beforeAll(async () => {
    work = mkdtempSync(path.join(tmpdir(), 'x2w-core-deploy-dns-'))
    chmodSync(work, 0o755)
    const scenario = path.join(work, 'scenario.mts')
    writeFileSync(scenario, SCENARIO)
    const child = spawn('unshare', ['-m', '-n', '--propagation', 'private', TSX, scenario], {
      cwd: SERVER_DIR,
      env: { ...process.env, X2W_NGINX: NGINX!, ROOT, WORK: work, HELPERS },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (d) => (stdout += d))
    child.stderr!.on('data', (d) => (stderr += d))
    const code = await new Promise<number | null>((r) => child.on('exit', r))
    const line = stdout.split('\n').find((l) => l.startsWith('@@RESULT@@'))
    if (!line) throw new Error(`cenário falhou (código ${code}):\n${stdout}\n${stderr}`)
    result = JSON.parse(line.slice('@@RESULT@@'.length))
    if (process.env.X2W_DEBUG) console.log(JSON.stringify(result, null, 2))
  }, 120_000)

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true })
  })

  it('o cenário usa o deploy/nginx.conf (resolver do Docker e proxy_pass com variável)', () => {
    expect(result.proxyPassLine).toBe('proxy_pass $x2w_api;')
    expect(result.resolverLine).toBe('resolver 127.0.0.11 valid=10s ipv6=off;')
  })

  it('A: com o contêiner "api" parado, o web sobe e serve o painel e o redirecionamento 80->443', () => {
    expect(result.A_nginx_t).toBe('ok')
    expect(result.A_nginx_start).toBe('running')
    expect(result.A_panel_https).toMatch(/^200 /)
    expect(result.A_redirect_http).toMatch(/^301 /)
    // a API fora do ar aparece como 502 só em /api
    expect(result.A_api_while_down).toMatch(/^502 /)
  })

  it('B: api recriado com IP novo => /api volta a responder sem reiniciar o web', () => {
    // pré-condições do cenário: API respondia antes, o DNS já aponta para o IP novo e a API nova responde
    expect(result.B1_before_recreate).toMatch(/^200 .*"ok":true/)
    expect(result.B2_getent_hosts_api).toMatch(/^172\.30\.0\.5\s+api$/)
    expect(result.B2_direct_by_name).toMatch(/^200 .*"ok":true/)
    // sem reinício do web, o painel volta a falar com a API nova dentro da validade do resolver (10 s)
    expect(result.B3_last_after_20s_or_recovery, JSON.stringify(result.B3_error_log)).toMatch(/^200 .*"ok":true/)
    expect(result.B3_seconds_until_recovery).toBeLessThanOrEqual(15)
    expect(result.B3_panel_static).toMatch(/^200 /)
    expect(result.B4_after_nginx_reload).toMatch(/^200 .*"ok":true/)
  })
})
