# Render.com Deployment Guide for FOUND Website

## Overview
This guide walks you through deploying the FOUND website to Render.com, a modern cloud platform that makes it easy to deploy Node.js applications.

## Prerequisites
- GitHub account with your FOUND website repository
- Render.com account (free signup at render.com)
- FOUND binary (optional - the site works without it for testing)

## Deployment Methods

### Method 1: Automatic Deployment with render.yaml (Recommended)

The repository includes a `render.yaml` file that automatically configures your deployment:

```yaml
services:
  - type: web
    name: found-website
    env: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
    autoDeploy: false
```

**Steps:**
1. **Push to GitHub**: Ensure your code is committed and pushed to GitHub
2. **Connect to Render**: 
   - Go to [render.com](https://render.com) and sign in
   - Click "New +" → "Blueprint"
   - Connect your GitHub account if not already connected
   - Select your `found-website` repository
   - Render will automatically detect the `render.yaml` file
3. **Deploy**: Click "Apply" and Render will automatically deploy your application

### Method 2: Manual Web Service Setup

If you prefer manual configuration:

1. **Create New Web Service**:
   - Go to your Render dashboard
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure Settings**:
   ```
   Name: found-website
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   Plan: Free (or paid for production use)
   ```

3. **Environment Variables**:
   - `NODE_ENV`: `production`
   - `PORT`: (automatically set by Render)

4. **Deploy**: Click "Create Web Service"

## Post-Deployment Setup

### 1. Verify Deployment
- Your app will be available at: `https://your-app-name.onrender.com`
- Check the health endpoint: `https://your-app-name.onrender.com/health`

### 2. Add FOUND Binary (Optional)
If you have the FOUND binary:

1. **Upload via SSH or file transfer** (for paid plans with SSH access)
2. **Include in repository**: 
   - Add binary to `./build/bin/found`
   - Make executable: `chmod +x ./build/bin/found`
   - Commit and push to trigger redeploy

### 3. Test Functionality
- Upload an image through the web interface
- Verify camera specs extraction works
- If binary is missing, you'll see "you couldn't be found" error (expected)

## Important Notes

### Free Plan Limitations
- **Cold starts**: Apps sleep after 15 minutes of inactivity
- **Build time**: Limited to 10 minutes
- **Storage**: Ephemeral (uploaded files are lost on restart)
- **Bandwidth**: 100GB/month

### File Storage Considerations
The current setup stores uploaded images in the `uploads/` directory, which is:
- ✅ **Good for testing**: Works fine for development/demo
- ❌ **Not persistent**: Files are lost when the service restarts
- 🔄 **Solution for production**: Consider using cloud storage (AWS S3, Cloudinary, etc.)

### Performance Optimization
For production use, consider:
- Upgrading to a paid plan for better performance
- Adding a CDN for static assets
- Implementing proper logging and monitoring

## Troubleshooting

### Common Issues

1. **Build Fails**:
   - Check Node.js version compatibility (requires Node 18+)
   - Verify all dependencies are in `package.json`
   - Check build logs in Render dashboard

2. **App Won't Start**:
   - Ensure `npm start` command works locally
   - Check that PORT environment variable is used correctly
   - Review application logs

3. **Binary Issues**:
   - Verify binary exists at `./build/bin/found`
   - Check binary permissions (`chmod +x`)
   - Ensure binary is compatible with Render's Linux environment

### Debugging
- **Logs**: View real-time logs in Render dashboard
- **Health Check**: Use `/health` endpoint to verify server status
- **Local Testing**: Always test locally first with `npm start`

## Environment Variables Reference

| Variable | Value | Description |
|----------|--------|-------------|
| `NODE_ENV` | `production` | Sets production environment |
| `PORT` | (auto-set) | Port for the web service |

## Custom Domain (Optional)
For paid plans, you can add a custom domain:
1. Go to Settings → Custom Domains
2. Add your domain
3. Configure DNS records as instructed

## Monitoring and Maintenance

### Health Monitoring
- Render provides built-in health checks
- Custom health endpoint: `/health`
- Monitor response times and uptime

### Updates
- **Automatic**: Enable auto-deploy for automatic updates on git push
- **Manual**: Trigger deploys manually from Render dashboard

### Scaling
- Free plan: Single instance
- Paid plans: Auto-scaling available

## Security Considerations

- HTTPS is automatically provided
- Environment variables are encrypted
- File uploads are limited to 10MB
- Only image files are accepted

## Cost Estimate

- **Free Plan**: $0/month (sufficient for demos/testing)
- **Starter Plan**: $7/month (better performance, custom domains)
- **Pro Plan**: $25/month (production features, scaling)

## Next Steps After Deployment

1. **Test thoroughly** with various image types
2. **Add FOUND binary** when available
3. **Monitor performance** and errors
4. **Consider upgrading** for production use
5. **Implement proper logging** for debugging

Your FOUND website should now be live and accessible worldwide! 🚀
