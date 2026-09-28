import { Notification } from "../models/index.js";
import { logger } from "../config/logger.js";
import { NOTIFICATION_CHANNELS } from "../constants/index.js";
import { paginateQuery } from "../utils/pagination.js";
import { NotFoundError } from "../utils/errors.js";

/** Channel adapters. In-app is real; email/web-push are pluggable stubs. */
const adapters = {
  [NOTIFICATION_CHANNELS.IN_APP]: async ({ companyId, userId, title, body, data }) =>
    Notification.create({ companyId, userId, title, body, data }),
  [NOTIFICATION_CHANNELS.EMAIL]: async ({ to, title }) => {
    logger.info({ msg: "email adapter not configured; message not sent", subject: title, hasRecipient: Boolean(to) });
  },
  [NOTIFICATION_CHANNELS.WEB_PUSH]: async ({ userId, title }) => {
    logger.info({ msg: "web-push adapter not configured; push not sent", userId: String(userId), title });
  },
};

export const registerChannel = (channel, fn) => { adapters[channel] = fn; };

export async function notify(payload, channels = [NOTIFICATION_CHANNELS.IN_APP]) {
  for (const ch of channels) {
    try {
      await adapters[ch]?.(payload);
    } catch (err) {
      logger.error({ msg: "notification failed", channel: ch, err: err.message });
    }
  }
}

export const listNotifications = (userId, query) =>
  paginateQuery(Notification, { userId, ...(query.unread ? { readAt: null } : {}) }, query, { sortable: ["createdAt"] });

export const unreadCount = (userId) => Notification.countDocuments({ userId, readAt: null });

export async function markRead(userId, id) {
  const n = await Notification.findOneAndUpdate({ _id: id, userId }, { readAt: new Date() }, { returnDocument: "after" });
  if (!n) throw new NotFoundError("Notification not found");
  return n;
}
export const markAllRead = (userId) => Notification.updateMany({ userId, readAt: null }, { readAt: new Date() });
