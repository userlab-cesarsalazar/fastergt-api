'use strict'
const mysql = require('mysql2/promise')
const moment = require('moment-timezone')
const isOffline = process.env['IS_OFFLINE']
const { dbConfig } = require(`${isOffline ? '../..' : '.'}/commons/dbConfig`)
let { response, notifyEmail } = require(`${isOffline ? '../..' : '.'}/commons/utils`)
let storage = require('./packageStorage')
const request = require('request')
const date = moment()
  .tz('America/Guatemala')
  .format('YYYY-MM-DD')

const AWS = require('aws-sdk')
AWS.config.update({ region: 'us-east-1' })
const sns = new AWS.SNS()

module.exports.read = async (event, context) => {
  try {
    let page = 0
    let type = null
    let id = null

    if (event.queryStringParameters && event.queryStringParameters.page) {
      page = event.queryStringParameters.page
    }

    if (event.queryStringParameters && event.queryStringParameters.type) {
      type = event.queryStringParameters.type
    }

    if (event.queryStringParameters && event.queryStringParameters.id) {
      id = event.queryStringParameters.id
    }

    const connection = await mysql.createConnection(dbConfig)
    const [packages] = await connection.execute(storage.get(page, type, id))

    return response(200, packages, connection)
  } catch (e) {
    console.log(e, 'catch')
    return response(400, e, null)
  }
}

module.exports.detail = async (event, context) => {
  try {
    console.log(event.pathParameter, 'event.pathParameter')
    const package_id = event.pathParameters && event.pathParameters.package_id ? JSON.parse(event.pathParameters.package_id) : undefined

    if (package_id === undefined) throw 'pathParameters missing'

    let connection = await mysql.createConnection(dbConfig)
    const [users] = await connection.execute(storage.getByid(package_id))
    return response(200, users, connection)
  } catch (e) {
    return response(400, e, null)
  }
}

module.exports.create = async (event, context) => {
  try {
    let data = JSON.parse(event.body)
    if (!data.tracking || !data.client_id || !data.weight || !data.description) throw 'missing_parameter'

    data.ing_date = date

    let connection = await mysql.createConnection(dbConfig)

    const [checkPackage] = await connection.execute(storage.findByTracking(data))

    if (checkPackage.length > 0) {
      //update
      const [update] = await connection.execute(storage.put(checkPackage[0], data, date, null))
      if (update) await connection.execute(storage.postDetail(data, checkPackage[0].package_id, date))
    } else {
      //create

      const [save] = await connection.execute(storage.post(data))
      if (save) await connection.execute(storage.postDetail(data, save.insertId, date))
    }

    //const [userData] = await connection.execute(storage.getUserInfo(data.client_id))

    /*if (!data.status || data.status !== 'Registrado') {
      let template = prepareToSend(data, userData)
      await notifyEmail(AWS, template)

      let payload = {
        profile: userData,
        data: data,
      }
      const params = {
        Message: JSON.stringify(payload),
        TopicArn: 'arn:aws:sns:us-east-1:' + process.env['ACCOUNT_ID'] + ':send-sms-event',
      }

      await new Promise((resolve, reject) => {
        sns.publish(params, error => {
          if (error) {
            console.log('SNS error ', error)
            reject(error)
          } else {
            console.log('added')
            resolve('added')
          }
        })
      })
    }*/

    return response(200, data, connection)
  } catch (e) {
    console.log(e)
    return response(400, e, null)
  }
}

module.exports.update = async (event, context) => {
  try {
    const package_id = event.pathParameters && event.pathParameters.package_id ? JSON.parse(event.pathParameters.package_id) : undefined

    const download =
      event.queryStringParameters && event.queryStringParameters.download ? JSON.parse(event.queryStringParameters.download) : undefined

    if (package_id === undefined) throw 'pathParameters missing'

    let data = JSON.parse(event.body)

    if (!data) throw 'no data to update'

    const connection = await mysql.createConnection(dbConfig)

    /* Status
     * En Transito
     * Listo para Entrega en Domicilio
     * Recoger en Traestodo
     * Entregado
     * Entregado con saldo pendiente
     * */
    if (download) {
      
      const update = await connection.execute(storage.downloadSimple(date, package_id))
    } else {
      console.log('2')
      const update = await connection.execute(storage.updateStatus(data, package_id, date, data.status))
    }

    //if (update && data.status === 'Entregado con saldo pendiente') {
    const today = moment()
      .tz('America/Guatemala')
      .format('YYYY-MM-DD hh:mm:ss')
    await connection.execute(storage.saveRemaining(data, today))
    //}

    return response(200, data, connection)
  } catch (e) {
    console.log(e, 't')
    return response(400, e, null)
  }
}

module.exports.delete = async (event, context) => {
  try {
    const package_id = event.pathParameters && event.pathParameters.package_id ? JSON.parse(event.pathParameters.package_id) : undefined

    if (package_id === undefined) throw 'pathParameters missing'

    const connection = await mysql.createConnection(dbConfig)

    const update = await connection.execute(storage.delete(package_id))

    return response(200, update, connection)
  } catch (e) {
    return response(400, e, null)
  }
}

module.exports.updateStatus = async (event, context) => {
  try {
    let data = {}

    const package_id = event.pathParameters && event.pathParameters.package_id ? JSON.parse(event.pathParameters.package_id) : undefined

    if (event.queryStringParameters && event.queryStringParameters.status) {
      data.status_detail = event.queryStringParameters.status
    }

    const date = moment()
      .tz('America/Guatemala')
      .format('YYYY-MM-DD hh:mm:ss')

    const connection = await mysql.createConnection(dbConfig)
    const [packages] = await connection.execute(storage.postDetail(data, package_id, date))

    return response(200, packages, connection)
  } catch (e) {
    console.log(e, 'catch')
    return response(400, e, null)
  }
}

module.exports.transfer = async (event, context) => {
  try {
    let data = JSON.parse(event.body)
    let connection = await mysql.createConnection(dbConfig)

    const [checkPackage] = await connection.execute(storage.transfer(data))

    const [log] = await connection.execute(storage.logPackage(data))

    return response(200, checkPackage, connection)
  } catch (e) {
    console.log(e, 'error')
    return response(200, e, null)
  }
}

function prepareToSend(user, profile) {
  const template = {
    mailList: [profile[0].email],
    from: 'hola@traestodo.com',
    subject: `Paquete listo para entrega!!`,
    bcc: ['cesar.augs@gmail.com', 'minondo@hotmail.com'],
    body: {
      Html: {
        Charset: 'UTF-8',
        Data: `<p><br />Queríamos informarle que ya tenemos un paquete listo para ser entregado en nuestras oficinas, los datos del paquete son los siguientes:<br />
                <div>
                  Código de Cliente: ${user.client_id} <br />
                  Tracking: ${user.tracking} <br />
                  Peso en Lbs: ${user.weight} <br />
                  Flete USA/Guatemala: Q.${parseInt(user.cuota)} <br />
                  Total a Pagar: Q.${parseInt(user.cuota) * parseInt(user.weight)} <br />
                <div>
                </p>
                Nuestro horario de atención es de Lunes a Viernes de 9:00 a 18:00 horas, y nuestra dirección es:
                 12 Calle 2-04 Edificio Plaza del Sol, Zona 9 Oficina 410.
                 Envíanos un correo si quieres que te enviemos tu paquete a domicilio, tus preferencias de entrega las puedes modificar en Traestodo.com <br />`,
      },
    },
  }
  return template
}

module.exports.sendSMSEvent = async event => {
  try {
    const uuidv1 = require('uuid/v1')
    const id = uuidv1()

    let params = event.body
      ? typeof event.body === 'string'
        ? JSON.parse(event.body)
        : event.body
      : event.Records
      ? JSON.parse(event.Records[0].Sns.Message)
      : null

    console.log(params)

    if (!params) throw 'no_params'

    const SMS = `TRAESTODO, le informa que usted Codigo de Cliente: ${params.data.client_id} , tiene un paquete con el numero de tracking ${params.data.tracking} en nuestras oficinas. Contactenos al telefono 2360-8228`
    const phone = `502${params.profile[0].phone}`

    let URL = `https://comunicador.tigo.com.gt/api/http/send_to_contact?msisdn=${phone}&message=${SMS}&api_key=${process.env['API_KEY_TIGO']}&id=${id}`

    return new Promise((resolve, reject) => {
      request(
        {
          url: URL,
          method: 'GET',
          headers: {
            'content-type': 'application/json',
          },
          json: true,
        },
        function(error, result, body) {
          console.log(body, 'body')
          if (error) reject(error)
          resolve(body)
        }
      )
    })
  } catch (e) {
    console.log(e, 'catch')
    return response(400, e, null)
  }
}

module.exports.sesTopic = async (event, context) => {
  try {
    console.log(event, 'check event')
    return response(200, event, null)
  } catch (e) {
    console.log(e, 'error')
    return response(400, e, null)
  }
}
