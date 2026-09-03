'use strict'

const os = require('node:os')
const { syncBuiltinESMExports } = require('node:module')
const originalUserInfo = os.userInfo

os.userInfo = function compatibleUserInfo(...args) {
  try {
    return originalUserInfo.apply(os, args)
  } catch {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0
    return {
      uid,
      gid,
      username: process.env.USER || process.env.USERNAME || String(uid),
      homedir: process.env.HOME || '/storage/Users/currentUser',
      shell: process.env.SHELL || '/bin/sh',
    }
  }
}

syncBuiltinESMExports()
