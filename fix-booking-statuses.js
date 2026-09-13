const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixBookingStatuses() {
  try {
    // Find all PAID bookings that should be COMPLETED
    const paidBookings = await prisma.booking.findMany({
      where: { status: 'PAID' },
      include: { payment: { select: { status: true } } }
    });

    console.log(`Found ${paidBookings.length} bookings in PAID status\n`);

    for (const booking of paidBookings) {
      // Check if the payment is COMPLETED
      if (booking.payment?.status === 'COMPLETED') {
        console.log(`Fixing booking ${booking.id}`);
        console.log(`  Current status: PAID → COMPLETED (revert to trigger workflow correctly)`);
        
        // Revert to COMPLETED so workflow can proceed normally
        await prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'COMPLETED' }
        });
        
        console.log(`  ✓ Fixed\n`);
      }
    }

    console.log(`✓ Successfully fixed ${paidBookings.length} bookings`);
    console.log('\nWorkflow is now:');
    console.log('1. Provider marks booking COMPLETED');
    console.log('2. Payment is confirmed (optional, automatic with return verification)');
    console.log('3. Booking automatically transitions to PAID (can be done manually too)');
    console.log('4. Provider can request withdrawal\n');

  } catch (error) {
    console.error('Error fixing bookings:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

fixBookingStatuses();
