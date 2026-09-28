import { z, email, password } from "./common.js";

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), newPassword: password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).refine((v) => v.currentPassword !== v.newPassword, { message: "New password must differ", path: ["newPassword"] });
