import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { HttpError } from '../middleware/errors.js';
import { addMember, createRoom, deleteRoom, findRoom, LANGUAGES, listRoomsForUser, updateRoom } from './repository.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  language: z.enum(LANGUAGES).default('javascript'),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    language: z.enum(LANGUAGES).optional(),
  })
  .refine((v) => v.name !== undefined || v.language !== undefined, { message: 'Nothing to update' });

const idSchema = z.string().regex(/^[a-z0-9]{6,32}$/, 'Invalid room id');

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

roomsRouter.get('/', async (req, res) => {
  const rooms = await listRoomsForUser(currentUser(req).id);
  res.json({ rooms });
});

roomsRouter.post('/', async (req, res) => {
  const { name, language } = createSchema.parse(req.body);
  const room = await createRoom(currentUser(req).id, name, language);
  res.status(201).json({ room });
});

roomsRouter.get('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const room = await findRoom(id);
  if (!room) throw new HttpError(404, 'Room not found');
  await addMember(id, currentUser(req).id);
  res.json({ room });
});

roomsRouter.patch('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const fields = updateSchema.parse(req.body);
  const room = await findRoom(id);
  if (!room) throw new HttpError(404, 'Room not found');
  await updateRoom(id, fields);
  res.json({ room: await findRoom(id) });
});

roomsRouter.delete('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const room = await findRoom(id);
  if (!room) throw new HttpError(404, 'Room not found');
  if (room.ownerId !== currentUser(req).id) throw new HttpError(403, 'Only the owner can delete a room');
  await deleteRoom(id);
  res.status(204).end();
});
