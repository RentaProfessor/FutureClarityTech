import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, message } = body;

    // Basic validation
    if (!email || !message) {
      return new Response(JSON.stringify({ 
        error: 'Email and message are required' 
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ 
        error: 'Please provide a valid email address' 
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // In a real application, you would:
    // 1. Save to a database
    // 2. Send an email notification
    // 3. Add to a CRM system
    // 4. Send a confirmation email to the user
    
    // For now, we'll just log the contact form submission
    console.log('Contact form submission:', {
      email,
      message,
      timestamp: new Date().toISOString(),
      ip: request.headers.get('x-forwarded-for') || 'unknown'
    });

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Thank you for your message! We\'ll get back to you soon.' 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Contact form error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Something went wrong. Please try again later.' 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
};
