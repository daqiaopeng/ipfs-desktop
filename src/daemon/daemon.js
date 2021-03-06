const Ctl = require('ipfsd-ctl')
const i18n = require('i18next')
const { execFileSync } = require('child_process')
const { showDialog } = require('../dialogs')
const logger = require('../common/logger')
const { applyDefaults, checkCorsConfig, checkPorts, configExists, apiFileExists } = require('./config')

function cannotConnectDialog (addr) {
  showDialog({
    title: i18n.t('cannotConnectToApiDialog.title'),
    message: i18n.t('cannotConnectToApiDialog.message', { addr }),
    type: 'error',
    buttons: [
      i18n.t('close')
    ]
  })
}

function getIpfsBinPath () {
  return require('go-ipfs-dep')
    .path()
    .replace('app.asar', 'app.asar.unpacked')
}

async function cleanup (ipfsd) {
  const log = logger.start('[daemon] cleanup')

  if (!configExists(ipfsd)) {
    cannotConnectDialog(ipfsd.apiAddr)
    throw new Error('cannot connect to api')
  }

  log.info('run: ipfs repo fsck')
  const exec = getIpfsBinPath()

  try {
    execFileSync(exec, ['repo', 'fsck'], {
      env: {
        ...process.env,
        IPFS_PATH: ipfsd.path
      }
    })
    log.end()
  } catch (err) {
    log.fail(err)
  }
}

async function spawn ({ flags, path, keysize }) {
  const ipfsd = await Ctl.createController({
    ipfsHttpModule: require('ipfs-http-client'),
    ipfsBin: getIpfsBinPath(),
    ipfsOptions: {
      repo: path
    },
    remote: false,
    disposable: false,
    test: false,
    args: flags
  })

  if (configExists(ipfsd)) {
    checkCorsConfig(ipfsd)
    return { ipfsd, isRemote: false }
  }

  // If config does not exist, but $IPFS_PATH/api exists, then
  // it is a remote repository.
  if (apiFileExists(ipfsd)) {
    return { ipfsd, isRemote: true }
  }

  await ipfsd.init({
    bits: keysize
  })

  applyDefaults(ipfsd)
  return { ipfsd, isRemote: false }
}

module.exports = async function (opts) {
  const { ipfsd, isRemote } = await spawn(opts)
  if (!isRemote) await checkPorts(ipfsd)

  try {
    await ipfsd.start()
    const { id } = await ipfsd.api.id()
    logger.info(`[daemon] PeerID is ${id}`)
    logger.info(`[daemon] Repo is at ${ipfsd.path}`)
  } catch (err) {
    if (!err.message.includes('ECONNREFUSED')) {
      throw err
    }

    await cleanup(ipfsd)
    await ipfsd.start()
  }

  return ipfsd
}
