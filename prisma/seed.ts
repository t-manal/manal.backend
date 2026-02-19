import 'dotenv/config';
import { PrismaClient, Role, EnrollmentStatus, PartFileType, PaymentProvider, PaymentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Starting Seeding (Admin-Only): World-Class Middle Eastern identity platform...');

    // 1. Instructor/Admin Creation
    // Schema Evidence: Role Enum only has STUDENT, INSTRUCTOR. Using INSTRUCTOR for Admin (Single-ADMIN Contract).
    console.log('--- 👤 Seeding Admins & Instructors ---');
    const instructorEmail = 'instructor@lms.com';
    const adminHashedPassword = await bcrypt.hash('Admin@123', 10);
    const instructor = await prisma.user.upsert({
        where: { email: instructorEmail },
        update: { password: adminHashedPassword },
        create: {
            email: instructorEmail,
            username: 'admin_manal',
            password: adminHashedPassword,
            role: Role.INSTRUCTOR,
            firstName: 'Manal',
            lastName: 'Academy',
            emailVerifiedAt: new Date(), // Admin is verified
        },
    });
    console.log(`Instructor "${instructor.firstName}" ready.`);

    // 2. Site Settings
    console.log('--- ⚙️ Seeding Site Settings ---');
    await prisma.siteSettings.upsert({
        where: { key: 'default' },
        update: {},
        create: {
            key: 'default',
            aboutContent: 'Manal LMS: The leading specialized education platform in the MENA region.',
            contactEmail: 'contact@manal-lms.com',
            whatsappNumber: '+966500000000',
            facebookUrl: 'https://facebook.com/manal.lms',
            twitterUrl: 'https://twitter.com/manal_lms',
        },
    });

    // 3. Universities - DISABLED (Admin Only)
    // console.log('--- 🏛️ Seeding Universities (V2 Simplified) ---');
    // const universities = await seedUniversities();

    // 4. Courses & Curriculum - DISABLED (Admin Only)
    // console.log('--- 📚 Seeding Courses & New Tree Curriculum ---');
    // const courseIds = await seedCoursesV2(instructor.id, universities);

    // 5. Students - DISABLED (Admin Only)
    // console.log('--- 🎓 Seeding Students ---');
    // const students = await seedStudents();

    // 6. Enrollments & Progress - DISABLED (Admin Only)
    // console.log('--- 📈 Seeding Enrollments & V2 Progress ---');
    // await seedEnrollmentsV2(students, courseIds);

    console.log('✅ Seeding completed successfully (Admin-only)!');
}

// Mock Data Functions - DISABLED to prevent accidental usage
/*
async function seedUniversities() {
    const universitiesData = [
        { name: 'King Saud University', logo: 'https://placehold.co/200x200?text=KSU' },
        { name: 'University of Jordan', logo: 'https://placehold.co/200x200?text=UJ' },
        { name: 'American University of Cairo', logo: 'https://placehold.co/200x200?text=AUC' },
    ];

    const createdUniversities: { id: string; name: string }[] = [];

    for (const uData of universitiesData) {
        let university = await prisma.university.findFirst({ where: { name: uData.name } });
        if (!university) {
            university = await prisma.university.create({ data: uData });
        }
        createdUniversities.push({ id: university.id, name: university.name });
    }

    return createdUniversities;
}

async function seedCoursesV2(instructorId: string, universities: { id: string; name: string }[]) {
    const courseData = [
        { title: "Mastering AI in Arabic Context", price: 99.99 },
        { title: "Civil Engineering: Structural Analysis", price: 0 },
        { title: "Introduction to Anatomy & Physiology", price: 49.99 },
        { title: "Advanced React Patterns for Enterprise", price: 79.99 },
    ];

    const courseIds: string[] = [];

    for (let i = 0; i < courseData.length; i++) {
        const c = courseData[i];
        const slug = c.title.toLowerCase().replace(/ /g, '-') + '-' + Math.floor(Math.random() * 1000);
        
        // V2: Assign directly to university (round-robin)
        const universityId = universities[i % universities.length].id;

        let course = await prisma.course.findFirst({ where: { title: c.title } });
        if (!course) {
            course = await prisma.course.create({
                data: {
                    title: c.title,
                    slug,
                    description: `This is a comprehensive course on ${c.title}, designed for students seeking world-class knowledge with a Middle Eastern perspective.`,
                    price: c.price,
                    instructorId,
                    universityId, // V2: Direct link to university
                    isPublished: true,
                    isFree: false, // V2 Governance: Zero-price ≠ Free. Manual approval required.
                    thumbnail: null, // V2 Contract: No course thumbnails
                }
            });

            // Create 2 Lectures (was Sections)
            for (let l = 1; l <= 2; l++) {
                const lecture = await prisma.lecture.create({
                    data: {
                        title: `Lecture ${l}: ${l === 1 ? 'Core Concepts' : 'Advanced Applications'}`,
                        order: l,
                        courseId: course.id,
                    }
                });

                // Create 2 Parts (was Lessons) per Lecture
                for (let p = 1; p <= 2; p++) {
                    const part = await prisma.part.create({
                        data: {
                            title: `Part ${p}: ${l}.${p} Module`,
                            order: p,
                            lectureId: lecture.id,
                        }
                    });

                    // 1. PartLesson (Video)
                    await prisma.partLesson.create({
                        data: {
                            title: 'Video Lecture',
                            video: 'demo-video-id', // Bunny ID
                            order: 1,
                            partId: part.id,
                        }
                    });

                    // 2. PartFile (PDF) - Create for every part
                    await prisma.partFile.create({
                        data: {
                            title: 'Resource PDF',
                            type: PartFileType.PDF,
                            storageKey: 'demo-pdf-key',
                            order: 2,
                            partId: part.id,
                        }
                    });
                     // 3. PartFile (PPTX) - Only for 2nd part of 2nd lecture
                     if (l === 2 && p === 2) {
                        await prisma.partFile.create({
                            data: {
                                title: 'Summary Slides',
                                type: PartFileType.PPTX,
                                storageKey: 'demo-pptx-key',
                                order: 3,
                                partId: part.id,
                            }
                        });
                    }

                }
            }
        }
        courseIds.push(course.id);
    }
    return courseIds;
}

async function seedStudents() {
    const studentNames = [
        { first: 'Ahmed', last: 'Al-Sayed', email: 'student1@lms.com' },
        { first: 'Fatima', last: 'Khalid', email: 'student2@lms.com' },
        { first: 'Mohammed', last: 'Rashid', email: 'student3@lms.com' },
        { first: 'Noora', last: 'Al-Mansouri', email: 'student4@lms.com' },
        { first: 'Youssef', last: 'Hassan', email: 'student5@lms.com' },
    ];

    const hashedPassword = await bcrypt.hash('Student@123', 10);
    const studentIds: string[] = [];

    for (const s of studentNames) {
        const user = await prisma.user.upsert({
            where: { email: s.email },
            update: { password: hashedPassword },
            create: {
                email: s.email,
                username: (s.first + s.last.replace('-', '')).toLowerCase().substring(0, 15) + Math.floor(Math.random() * 100),
                password: hashedPassword,
                firstName: s.first,
                lastName: s.last,
                role: Role.STUDENT,
                emailVerifiedAt: new Date(), // Seed students are verified
            }
        });
        studentIds.push(user.id);
    }
    return studentIds;
}

async function seedEnrollmentsV2(studentIds: string[], courseIds: string[]) {
    for (const studentId of studentIds) {
        // Enroll in first 2 courses
        const selectedCourses = courseIds.slice(0, 2);

        for (let idx = 0; idx < selectedCourses.length; idx++) {
            const courseId = selectedCourses[idx];
            const status = idx === 0 ? EnrollmentStatus.ACTIVE : EnrollmentStatus.PENDING;

            const enrollment = await prisma.enrollment.upsert({
                where: { userId_courseId: { userId: studentId, courseId } },
                update: { status },
                create: {
                    userId: studentId,
                    courseId,
                    status,
                    ...(status === EnrollmentStatus.ACTIVE ? { activatedAt: new Date() } : {}),
                }
            });

            // Manual Fulfillment Contract: Every ACTIVE enrollment must have PaymentRecord with MANUAL_WHATSAPP
            if (status === EnrollmentStatus.ACTIVE) {
                const course = await prisma.course.findUnique({ where: { id: courseId } });
                
                await prisma.paymentRecord.upsert({
                    where: { providerEventId: `seed-${enrollment.id}` },
                    update: {},
                    create: {
                        enrollmentId: enrollment.id,
                        userId: studentId,
                        courseId,
                        provider: PaymentProvider.MANUAL_WHATSAPP,
                        providerEventId: `seed-${enrollment.id}`,
                        amount: course?.price || 0,
                        currency: 'SAR',
                        status: PaymentStatus.COMPLETED,
                    }
                });

                // Simulate V2 Progress (PartProgress)
                const parts = await prisma.part.findMany({
                    where: { lecture: { courseId } },
                    take: 2,
                    orderBy: { order: 'asc' }
                });

                for (const part of parts) {
                    await prisma.partProgress.upsert({
                        where: { userId_partId: { userId: studentId, partId: part.id } },
                        update: {},
                        create: {
                            userId: studentId,
                            partId: part.id,
                            isVideoCompleted: true,
                            completedAt: new Date(),
                            lastPositionSeconds: 150
                        }
                    });
                    
                    // Update CourseProgress pointer
                    await prisma.courseProgress.upsert({
                        where: { userId_courseId: { userId: studentId, courseId } },
                        update: { lastPartId: part.id },
                        create: {
                            userId: studentId,
                            courseId: courseId,
                            lastPartId: part.id
                        }
                    });
                }
            }
        }
    }
}
*/

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
