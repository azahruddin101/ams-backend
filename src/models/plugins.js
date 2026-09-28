import mongoose from "mongoose";

/** Adds soft-delete fields and hides deleted docs from default finds. */
export function softDelete(schema) {
  schema.add({ deletedAt: { type: Date, default: null }, deletedBy: { type: mongoose.Schema.Types.ObjectId, default: null } });
  const hide = function () {
    if (this.getOptions().withDeleted) return;
    const f = this.getFilter();
    if (f.deletedAt === undefined) this.where({ deletedAt: null });
  };
  for (const hook of ["find", "findOne", "countDocuments", "findOneAndUpdate", "updateOne", "updateMany"]) schema.pre(hook, hide);
}

/** Never leak these fields via toJSON. */
export function hideFields(...fields) {
  return (schema) => {
    schema.set("toJSON", {
      virtuals: false,
      versionKey: false,
      transform: (_doc, ret) => {
        for (const f of fields) delete ret[f];
        return ret;
      },
    });
  };
}
