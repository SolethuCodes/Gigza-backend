import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { MessagesService } from './messages.service';
import { SenderType } from '@prisma/client';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
      },
      message: {
        create: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new MessagesService(prisma);
  });

  it('creates a conversation when the first message is sent for a booking', async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      userId: 'user-1',
      providerId: 'provider-1',
    });

    prisma.message.create.mockResolvedValue({
      id: 'message-1',
      bookingId: 'booking-1',
      senderId: 'user-1',
      senderType: SenderType.USER,
      text: 'Hello there',
      type: 'TEXT',
      metadata: null,
      createdAt: new Date(),
    });

    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conversation-1' });

    await service.createMessage('booking-1', 'user-1', SenderType.USER, { text: 'Hello there' } as any);

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: 'booking-1',
          senderId: 'user-1',
          text: 'Hello there',
        }),
      }),
    );

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: 'booking-1',
          lastMessageText: 'Hello there',
        }),
      }),
    );
  });
});
