import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp');

function escapeSvg(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export class ImageTextOverlay implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Image Text Overlay',
		name: 'imageTextOverlay',
		icon: { light: 'file:imageTextOverlay.svg', dark: 'file:imageTextOverlay.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Overlay text onto an image',
		defaults: {
			name: 'Image Text Overlay',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property that contains the image',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				default: '',
				required: true,
				description: 'Text to overlay on the image',
			},
			{
				displayName: 'Text Color',
				name: 'color',
				type: 'color',
				default: '#ffffff',
				description: 'CSS color for the text (for example, #ffffff or red)',
			},
			{
				displayName: 'Font Size',
				name: 'fontSize',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 48,
				description: 'Font size in pixels',
			},
			{
				displayName: 'Font Family',
				name: 'fontFamily',
				type: 'options',
				options: [
					{
						name: 'Arial',
						value: 'Arial, sans-serif',
					},
					{
						name: 'Roboto',
						value: 'Roboto, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					},
					{
						name: 'Open Sans',
						value: '"Open Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					},
					{
						name: 'Montserrat',
						value: '"Montserrat", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					},
					{
						name: 'Lato',
						value: 'Lato, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					},
					{
						name: 'Courier New (Monospace)',
						value: '"Courier New", Courier, monospace',
					},
					{
						name: 'Georgia (Serif)',
						value: 'Georgia, "Times New Roman", serif',
					},
					{
						name: 'Custom...',
						value: 'custom',
					},
				],
				default: 'Arial, sans-serif',
				description: 'Font family to use for the text',
			},
			{
				displayName: 'Custom Font Family',
				name: 'fontFamilyCustom',
				type: 'string',
				default: 'Arial, sans-serif',
				description:
					'CSS font-family string to use when Font Family is set to "Custom..."',
				displayOptions: {
					show: {
						fontFamily: ['custom'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const binaryPropertyName = this.getNodeParameter(
					'binaryPropertyName',
					itemIndex,
					'data',
				) as string;
				const text = this.getNodeParameter('text', itemIndex) as string;
				const color = this.getNodeParameter('color', itemIndex) as string;
				const fontSize = this.getNodeParameter('fontSize', itemIndex) as number;
				let fontFamily = this.getNodeParameter('fontFamily', itemIndex) as string;

				if (fontFamily === 'custom') {
					fontFamily = this.getNodeParameter('fontFamilyCustom', itemIndex) as string;
				}

				const inputBinaryData = await this.helpers.getBinaryDataBuffer(
					itemIndex,
					binaryPropertyName,
				);
				const originalBinaryProperty = items[itemIndex].binary?.[binaryPropertyName];

				const mimeType = originalBinaryProperty?.mimeType ?? 'image/png';

				const image = sharp(inputBinaryData);
				const metadata = await image.metadata();

				if (!metadata.width || !metadata.height) {
					throw new NodeOperationError(
						this.getNode(),
						'Could not determine image dimensions',
						{ itemIndex },
					);
				}

				const width = metadata.width;
				const height = metadata.height;

				const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <style>
    .overlay-text { fill: ${color}; font-size: ${fontSize}px; font-family: ${fontFamily}; }
  </style>
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" class="overlay-text">${escapeSvg(
					text,
				)}</text>
</svg>`;

				const format =
					mimeType === 'image/png'
						? 'png'
						: mimeType === 'image/jpeg' || mimeType === 'image/jpg'
						? 'jpeg'
						: mimeType === 'image/webp'
						? 'webp'
						: 'png';

				const overlaidBuffer = await image
					.composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
					.toFormat(format)
					.toBuffer();

				const outputMimeType =
					format === 'png'
						? 'image/png'
						: format === 'jpeg'
						? 'image/jpeg'
						: format === 'webp'
						? 'image/webp'
						: 'image/png';

				const newBinaryData = await this.helpers.prepareBinaryData(
					overlaidBuffer,
					outputMimeType,
				);

				newBinaryData.fileName =
					originalBinaryProperty?.fileName ?? `image-with-text.${format}`;

				const newItem: INodeExecutionData = {
					json: items[itemIndex].json,
					binary: {
						...(items[itemIndex].binary ?? {}),
						[binaryPropertyName]: newBinaryData,
					},
				};

				returnData.push(newItem);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							...(items[itemIndex]?.json ?? {}),
							error: (error as Error).message,
						},
						pairedItem: itemIndex,
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}

