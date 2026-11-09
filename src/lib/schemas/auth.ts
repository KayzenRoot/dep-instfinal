import { z } from 'zod';

export const loginCredentialsSchema = z.object({
	email: z.email().trim().max(254),
	password: z.string().min(1).max(1024),
});

export const recoveryEmailSchema = z.object({
	email: z.email().trim().max(254),
});

export const newPasswordSchema = z
	.object({
		password: z.string().min(12).max(128),
		confirmPassword: z.string().min(12).max(128),
	})
	.refine((value) => value.password === value.confirmPassword, {
		path: ['confirmPassword'],
		message: 'As senhas não coincidem.',
	});
