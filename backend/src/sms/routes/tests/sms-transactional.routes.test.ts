import request from 'supertest'
import { Sequelize } from 'sequelize-typescript'

import { User, Credential, UserCredential } from '@core/models'
import { ChannelType } from '@core/constants'
import { RateLimitError, InvalidRecipientError } from '@core/errors'
import { TemplateError } from '@shared/templating'
import { SmsService } from '@sms/services'

import { mockSecretsManager } from '@mocks/aws-sdk'
import initialiseServer from '@test-utils/server'
import sequelizeLoader from '@test-utils/sequelize-loader'
import { SmsMessageTransactional } from '@sms/models'

const TEST_TWILIO_CREDENTIALS = {
  accountSid: '',
  apiKey: '',
  apiSecret: '',
  messagingServiceSid: '',
}

let sequelize: Sequelize
let user: User
let apiKey: string
let credential: Credential

const app = initialiseServer(false)

beforeEach(async () => {
  user = await User.create({
    id: 1,
    email: 'user_1@agency.gov.sg',
  } as User)
  const userId = user.id
  apiKey = await user.regenerateAndSaveApiKey()
  await UserCredential.create({
    label: `twilio-${userId}`,
    type: ChannelType.SMS,
    credName: credential.name,
    userId,
  } as UserCredential)
})

beforeAll(async () => {
  sequelize = await sequelizeLoader(process.env.JEST_WORKER_ID || '1')
  credential = await Credential.create({ name: 'twilio' } as Credential)
})

afterEach(async () => {
  jest.clearAllMocks()
  await SmsMessageTransactional.destroy({ where: {} })
  await User.destroy({ where: {} })
  await UserCredential.destroy({ where: {} })
})

afterAll(async () => {
  await sequelize.close()
  await (app as any).cleanup()
})

describe('POST /transactional/sms/send', () => {
  const validApiCall = {
    body: 'Hello world',
    recipient: '98765432',
    label: 'twilio-1',
  }

  test('Should throw an error if API key is invalid', async () => {
    const res = await request(app)
      .post('/transactional/sms/send')
      .set('Authorization', `Bearer invalid-${apiKey}`)
      .send({})

    expect(res.status).toBe(401)
  })

  test('Should throw an error if API key is valid but payload is not', async () => {
    const res = await request(app)
      .post('/transactional/sms/send')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({})

    expect(res.status).toBe(400)
  })

  test('Should send a message successfully', async () => {
    const mockSendMessageResolvedValue = 'message_id'
    const mockSendMessage = jest
      .spyOn(SmsService, 'sendMessage')
      .mockResolvedValue(mockSendMessageResolvedValue)
    mockSecretsManager.getSecretValue().promise.mockResolvedValueOnce({
      SecretString: JSON.stringify(TEST_TWILIO_CREDENTIALS),
    })

    const res = await request(app)
      .post('/transactional/sms/send')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(validApiCall)

    expect(res.status).toBe(201)
    expect(mockSendMessage).toBeCalledTimes(1)
    const transactionalSms = await SmsMessageTransactional.findOne({
      where: { userId: user.id.toString() },
    })
    expect(transactionalSms).not.toBeNull()
    expect(transactionalSms).toMatchObject({
      recipient: validApiCall.recipient,
      body: validApiCall.body,
      userId: user.id.toString(),
      credentialsLabel: validApiCall.label,
      messageId: mockSendMessageResolvedValue,
    })
    mockSendMessage.mockReset()
  })

  test('Should return a HTTP 400 when template is invalid', async () => {
    const mockSendMessage = jest
      .spyOn(SmsService, 'sendMessage')
      .mockRejectedValueOnce(new TemplateError('Invalid template'))
    mockSecretsManager.getSecretValue().promise.mockResolvedValueOnce({
      SecretString: JSON.stringify(TEST_TWILIO_CREDENTIALS),
    })

    const res = await request(app)
      .post('/transactional/sms/send')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(validApiCall)

    expect(res.status).toBe(400)
    expect(mockSendMessage).toBeCalledTimes(1)
    mockSendMessage.mockReset()
  })

  test('Should return a HTTP 400 when recipient is not valid', async () => {
    const mockSendMessage = jest
      .spyOn(SmsService, 'sendMessage')
      .mockRejectedValueOnce(new InvalidRecipientError())
    mockSecretsManager.getSecretValue().promise.mockResolvedValueOnce({
      SecretString: JSON.stringify(TEST_TWILIO_CREDENTIALS),
    })

    const res = await request(app)
      .post('/transactional/sms/send')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(validApiCall)

    expect(res.status).toBe(400)
    expect(mockSendMessage).toBeCalledTimes(1)
    mockSendMessage.mockReset()
  })

  test('Should return a HTTP 429 when Twilio rate limits request', async () => {
    const mockSendMessage = jest
      .spyOn(SmsService, 'sendMessage')
      .mockRejectedValueOnce(new RateLimitError())
    mockSecretsManager.getSecretValue().promise.mockResolvedValueOnce({
      SecretString: JSON.stringify(TEST_TWILIO_CREDENTIALS),
    })

    const res = await request(app)
      .post('/transactional/sms/send')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(validApiCall)

    expect(res.status).toBe(429)
    expect(mockSendMessage).toBeCalledTimes(1)
    mockSendMessage.mockReset()
  })
})
