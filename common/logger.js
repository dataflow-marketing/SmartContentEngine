import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const myFormat = printf(({ level, message, timestamp }) => {
  return `[${level}] ${timestamp} - ${message}`;
});

export const logger = winston.createLogger({
  level: 'info',
  format: combine(
    colorize(),
    timestamp(),
    myFormat
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Add a helper function to log progress
logger.progress = (processed, total) => {
  const percentage = ((processed / total) * 100).toFixed(1);
  logger.info(`Progress: ${percentage}% complete (${processed} of ${total})`);
};
