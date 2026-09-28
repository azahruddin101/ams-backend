export const ok = (res, data = null, message = "Success", status = 200) =>
  res.status(status).json({ success: true, message, data });

export const created = (res, data, message = "Created successfully") => ok(res, data, message, 201);

export const paginated = (res, { items, page, limit, total }, message = "Success") =>
  res.status(200).json({
    success: true,
    message,
    data: items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
