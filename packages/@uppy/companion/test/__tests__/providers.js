/* global jest:false, test:false, expect:false, describe:false */

jest.mock('tus-js-client')
jest.mock('purest')
jest.mock('../../src/server/helpers/request', () => {
  return {
    getURLMeta: () => Promise.resolve({ size: 758051 }),
  }
})
jest.mock('../../src/server/helpers/oauth-state', () => require('../mockoauthstate')())

const request = require('supertest')
const nock = require('nock')

const fixtures = require('../fixtures')
const tokenService = require('../../src/server/helpers/jwt')
const { getServer } = require('../mockserver')
const defaults = require('../fixtures/constants')

// todo don't share server between tests. rewrite to not use env variables
const authServer = getServer({ COMPANION_CLIENT_SOCKET_CONNECT_TIMEOUT: '0' })
const OAUTH_STATE = 'some-cool-nice-encrytpion'
const providers = require('../../src/server/provider').getDefaultProviders()

const providerNames = Object.keys(providers)
const AUTH_PROVIDERS = {
  drive: 'google',
  onedrive: 'microsoft',
}
const authData = {}
providerNames.forEach((provider) => {
  authData[provider] = 'token value'
})
const token = tokenService.generateEncryptedToken(authData, process.env.COMPANION_SECRET)

const thisOrThat = (value1, value2) => {
  if (value1 !== undefined) {
    return value1
  }

  return value2
}

beforeAll(() => {
  const url = new URL(defaults.THUMBNAIL_URL)
  nock(url.origin).get(url.pathname).reply(200, () => '').persist()
})

afterAll(() => {
  nock.cleanAll()
  nock.restore()
})

describe('set i-am header', () => {
  test.each(providerNames)('set i-am header in response (%s)', (providerName) => {
    const providerFixtures = fixtures.providers[providerName].expects
    return request(authServer)
      .get(`/${providerName}/list/${providerFixtures.listPath || ''}`)
      .set('uppy-auth-token', token)
      .expect(200)
      .then((res) => expect(res.header['i-am']).toBe('http://localhost:3020'))
  })
})

describe('list provider files', () => {
  test.each(providerNames)('list files for %s', (providerName) => {
    const providerFixtures = fixtures.providers[providerName].expects
    return request(authServer)
      .get(`/${providerName}/list/${providerFixtures.listPath || ''}`)
      .set('uppy-auth-token', token)
      .expect(200)
      .then((res) => {
        expect(res.body.username).toBe(fixtures.defaults.USERNAME)

        const items = [...res.body.items]

        // Drive has a virtual "shared-with-me" folder as the first item
        if (providerName === 'drive') {
          const item0 = items.shift()
          expect(item0.isFolder).toBe(true)
          expect(item0.name).toBe('Shared with me')
          expect(item0.mimeType).toBe('application/vnd.google-apps.folder')
          expect(item0.id).toBe('shared-with-me')
          expect(item0.requestPath).toBe('shared-with-me')
          expect(item0.icon).toBe('folder')
        }

        const item = items[0]
        expect(item.isFolder).toBe(false)
        expect(item.name).toBe(providerFixtures.itemName || fixtures.defaults.ITEM_NAME)
        expect(item.mimeType).toBe(providerFixtures.itemMimeType || fixtures.defaults.MIME_TYPE)
        expect(item.id).toBe(providerFixtures.itemId || fixtures.defaults.ITEM_ID)
        expect(item.size).toBe(thisOrThat(providerFixtures.itemSize, fixtures.defaults.FILE_SIZE))
        expect(item.requestPath).toBe(providerFixtures.itemRequestPath || fixtures.defaults.ITEM_ID)
        expect(item.icon).toBe(providerFixtures.itemIcon || fixtures.defaults.THUMBNAIL_URL)
      })
  })
})

describe('download provider file', () => {
  test.each(providerNames)('specified file gets downloaded from %s', (providerName) => {
    const providerFixtures = fixtures.providers[providerName].expects
    return request(authServer)
      .post(`/${providerName}/get/${providerFixtures.itemRequestPath || fixtures.defaults.ITEM_ID}`)
      .set('uppy-auth-token', token)
      .set('Content-Type', 'application/json')
      .send({
        endpoint: 'http://tusd.tusdemo.net/files',
        protocol: 'tus',
      })
      .expect(200)
      .then((res) => expect(res.body.token).toBeTruthy())
  })
})

describe('connect to provider', () => {
  test.each(providerNames)('connect to %s via grant.js endpoint', (providerName) => {
    const authProvider = AUTH_PROVIDERS[providerName] || providerName

    return request(authServer)
      .get(`/${providerName}/connect?foo=bar`)
      .set('uppy-auth-token', token)
      .expect(302)
      .expect('Location', `http://localhost:3020/connect/${authProvider}?state=${OAUTH_STATE}`)
  })
})

describe('logout of provider', () => {
  test.each(providerNames)('logout of %s', (providerName) => {
    return request(authServer)
      .get(`/${providerName}/logout/`)
      .set('uppy-auth-token', token)
      .expect(200)
      .then((res) => expect(res.body.ok).toBe(true))
  })
})
