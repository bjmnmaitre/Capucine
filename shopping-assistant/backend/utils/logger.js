/**
 * Logger Utility
 * Système de logging simple et colorisé
 */

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

const COLORS = {
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m'
};

const getCurrentTimestamp = () => {
  return new Date().toISOString();
};

class Logger {
  constructor(level = 'INFO') {
    this.level = level;
  }

  _log(level, message, data = null) {
    const timestamp = getCurrentTimestamp();
    const levelColors = {
      ERROR: COLORS.RED,
      WARN: COLORS.YELLOW,
      INFO: COLORS.GREEN,
      DEBUG: COLORS.BLUE
    };

    const color = levelColors[level] || COLORS.RESET;
    const output = `${color}[${timestamp}] [${level}]${COLORS.RESET} ${message}`;

    if (data) {
      console.log(output, data);
    } else {
      console.log(output);
    }
  }

  error(message, data = null) {
    this._log(LOG_LEVELS.ERROR, message, data);
  }

  warn(message, data = null) {
    this._log(LOG_LEVELS.WARN, message, data);
  }

  info(message, data = null) {
    this._log(LOG_LEVELS.INFO, message, data);
  }

  debug(message, data = null) {
    if (process.env.DEBUG === 'true') {
      this._log(LOG_LEVELS.DEBUG, message, data);
    }
  }
}

module.exports = {
  logger: new Logger(process.env.LOG_LEVEL || 'INFO'),
  Logger,
  LOG_LEVELS,
  COLORS
};
