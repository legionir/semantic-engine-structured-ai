import { FastifyInstance, RequestHandler } from 'fastify';
import { AssetService } from '../assets/services/asset.service';

export const registerAssetRoutes = (server: FastifyInstance) => {
  // Initialize service
  const assetService = new AssetService(null); // Repository will be injected in actual implementation
  
  // Asset routes
  server.get('/assets', async (req, res) => {
    try {
      const assets = await assetService.findAll();
      res.code(200).send(assets);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.get('/assets/:id', async (req, res) => {
    try {
      const assetId = req.params['id'] as string;
      const asset = await assetService.findOne(assetId);
      if (!asset) {
        res.code(404).send({ error: 'Asset not found' });
        return;
      }
      res.code(200).send(asset);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.post('/assets', async (req, res) => {
    try {
      // Handle file upload in a real implementation
      const assetData = req.body;
      const newAsset = await assetService.create(assetData);
      res.code(201).send(newAsset);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.put('/assets/:id', async (req, res) => {
    try {
      const assetId = req.params['id'] as string;
      const updateData = req.body;
      const updatedAsset = await assetService.update(assetId, updateData);
      res.code(200).send(updatedAsset);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.delete('/assets/:id', async (req, res) => {
    try {
      const assetId = req.params['id'] as string;
      await assetService.remove(assetId);
      res.code(204).send(); // No content
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
};