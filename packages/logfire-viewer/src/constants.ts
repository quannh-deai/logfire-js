// Mirror of @pydantic/logfire-api/src/constants.ts. Re-declared here so the
// viewer is installable standalone without a workspace dependency on the SDK.

export const ATTRIBUTES_LEVEL_KEY = 'logfire.level_num'
export const ATTRIBUTES_SPAN_TYPE_KEY = 'logfire.span_type'
export const ATTRIBUTES_TAGS_KEY = 'logfire.tags'
export const ATTRIBUTES_MESSAGE_TEMPLATE_KEY = 'logfire.msg_template'
export const ATTRIBUTES_MESSAGE_KEY = 'logfire.msg'

export const LEVEL_LABELS: Record<number, string> = {
  1: 'trace',
  5: 'debug',
  9: 'info',
  10: 'notice',
  13: 'warning',
  17: 'error',
  21: 'fatal',
}

export const SERVICE_NAME = 'service.name'
export const SERVICE_VERSION = 'service.version'
export const DEPLOYMENT_ENVIRONMENT = 'deployment.environment'
