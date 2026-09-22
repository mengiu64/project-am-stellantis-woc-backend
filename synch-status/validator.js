// validator.js
// Validazione payload request per API REST
// Utilizza Joi per schemi strutturati

const Joi = require('joi');

// Schema per singolo evento Kafka
const kafkaEventSchema = Joi.object({
  eventId: Joi.string()
    .guid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': 'eventId deve essere UUID v4 valido',
      'any.required': 'eventId è obbligatorio'
    }),

  timestamp: Joi.string()
    .isoDate()
    .required()
    .messages({
      'string.isoDate': 'timestamp deve essere formato ISO 8601',
      'any.required': 'timestamp è obbligatorio'
    }),

  eventType: Joi.string()
    .valid('JOBS_UPDATE', 'APPOINTMENTS_UPDATE', 'VIDEOCHECK_JOB_UPDATED', 'JOBS_UPDATE_WITH_PREAPPROVAL')
    .required()
    .messages({
      'any.only': 'eventType non riconosciuto. Tipi validi: JOBS_UPDATE, APPOINTMENTS_UPDATE, VIDEOCHECK_JOB_UPDATED, JOBS_UPDATE_WITH_PREAPPROVAL',
      'any.required': 'eventType è obbligatorio'
    }),

  dealerId: Joi.string()
    .alphanum()
    .min(3)
    .max(20)
    .required()
    .messages({
      'string.min': 'dealerId deve essere almeno 3 caratteri',
      'string.max': 'dealerId non può superare 20 caratteri',
      'any.required': 'dealerId è obbligatorio'
    }),

  payload: Joi.object()
    .required()
    .messages({
      'any.required': 'payload è obbligatorio'
    })
}).unknown(true); // Consenti campi aggiuntivi per forward compatibility

// Schema per POST /api/synch-status
const postSynchStatusSchema = Joi.object({
  events: Joi.array()
    .items(kafkaEventSchema)
    .min(1)
    .max(100)
    .required()
    .messages({
      'array.min': 'events array deve contenere almeno 1 evento',
      'array.max': 'events array non può superare 100 eventi',
      'any.required': 'events è obbligatorio'
    })
}).unknown(false); // Non consentire campi al top level non previsti

// Schema per GET /api/synch-status/{requestId}
const getSynchStatusSchema = Joi.object({
  requestId: Joi.string()
    .guid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': 'requestId deve essere UUID v4 valido',
      'any.required': 'requestId è obbligatorio'
    })
});

class Validator {
  // Valida payload POST /api/synch-status
  static validatePostSynchStatus(body) {
    const { error, value } = postSynchStatusSchema.validate(body, {
      abortEarly: false, // Raccogli tutti gli errori, non fermarti al primo
      stripUnknown: true // Rimuovi campi non noti dopo validazione
    });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return {
        valid: false,
        errors: details,
        data: null
      };
    }

    return {
      valid: true,
      errors: null,
      data: value
    };
  }

  // Valida parametri GET /api/synch-status/{requestId}
  static validateGetSynchStatus(requestId) {
    const { error, value } = getSynchStatusSchema.validate({ requestId }, {
      abortEarly: false
    });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return {
        valid: false,
        errors: details,
        data: null
      };
    }

    return {
      valid: true,
      errors: null,
      data: value
    };
  }

  // Valida singolo evento Kafka
  static validateKafkaEvent(event) {
    const { error, value } = kafkaEventSchema.validate(event, {
      abortEarly: false
    });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return {
        valid: false,
        errors: details,
        data: null
      };
    }

    return {
      valid: true,
      errors: null,
      data: value
    };
  }

  // Valida header Authorization
  static validateAuthorizationHeader(header) {
    if (!header) {
      return {
        valid: false,
        error: 'Authorization header mancante',
        token: null
      };
    }

    // Formato: Bearer <token>
    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return {
        valid: false,
        error: 'Authorization header formato non valido. Usa: Bearer <token>',
        token: null
      };
    }

    return {
      valid: true,
      error: null,
      token: parts[1]
    };
  }
}

module.exports = Validator;
