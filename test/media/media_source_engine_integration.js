/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('MediaSourceEngine', () => {
  const ContentType = shaka.util.ManifestParserUtils.ContentType;
  const presentationDuration = 840;

  /** @type {!HTMLVideoElement} */
  let video;
  /** @type {!MediaSource} */
  let mediaSource;
  /** @type {!shaka.media.MediaSourceEngine} */
  let mediaSourceEngine;
  let generators;
  let metadata;
  // TODO: add text streams to MSE integration tests

  /**
   * We use a fake text displayer so that we can check if CEA text is being
   * passed through the system correctly.
   *
   * @type {!shaka.test.FakeTextDisplayer}
   */
  let textDisplayer;

  beforeAll(() => {
    video = shaka.test.UiUtils.createVideoElement();
    document.body.appendChild(video);
  });

  beforeEach(async () => {
    metadata = shaka.test.TestScheme.DATA['sintel'];
    generators = shaka.test.TestScheme.GENERATORS['sintel'];

    textDisplayer = new shaka.test.FakeTextDisplayer();

    mediaSourceEngine = new shaka.media.MediaSourceEngine(
        video,
        new shaka.media.ClosedCaptionParser(),
        textDisplayer);

    mediaSource = /** @type {?} */(mediaSourceEngine)['mediaSource_'];
    expect(video.src).toBeTruthy();
    await mediaSourceEngine.init(new Map(), false);
  });

  afterEach(async () => {
    await mediaSourceEngine.destroy();
  });

  afterAll(() => {
    document.body.removeChild(video);
  });

  function appendInit(type) {
    const segment = generators[type].getInitSegment(Date.now() / 1000);
    return mediaSourceEngine.appendBuffer(
        type, segment, null, null, /* hasClosedCaptions= */ false);
  }

  function append(type, segmentNumber) {
    const segment = generators[type]
        .getSegment(segmentNumber, Date.now() / 1000);
    return mediaSourceEngine.appendBuffer(
        type, segment, null, null, /* hasClosedCaptions= */ false);
  }

  // The start time and end time should be null for init segment with closed
  // captions.
  function appendInitWithClosedCaptions(type) {
    const segment = generators[type].getInitSegment(Date.now() / 1000);
    return mediaSourceEngine.appendBuffer(type, segment, /* startTime= */ null,
        /* endTime= */ null, /* hasClosedCaptions= */ true);
  }

  // The start time and end time should be valid for the segments with closed
  // captions.
  function appendWithClosedCaptions(type, segmentNumber) {
    const segment = generators[type]
        .getSegment(segmentNumber, Date.now() / 1000);
    return mediaSourceEngine.appendBuffer(type, segment, /* startTime= */ 0,
        /* endTime= */ 2, /* hasClosedCaptions= */ true);
  }

  function buffered(type, time) {
    return mediaSourceEngine.bufferedAheadOf(type, time);
  }

  function bufferStart(type) {
    return mediaSourceEngine.bufferStart(type);
  }

  function remove(type, segmentNumber) {
    const start = segmentNumber * metadata[type].segmentDuration;
    const end = (segmentNumber + 1) * metadata[type].segmentDuration;
    return mediaSourceEngine.remove(type, start, end);
  }

  function getFakeStream(streamMetadata) {
    return {
      mimeType: streamMetadata.mimeType,
      codecs: streamMetadata.codecs,
      drmInfos: [],
    };
  }

  it('buffers MP4 video', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInit(ContentType.VIDEO);
    expect(buffered(ContentType.VIDEO, 0)).toBe(0);
    await append(ContentType.VIDEO, 0);
    expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(10);
    await append(ContentType.VIDEO, 1);
    expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(20);
    await append(ContentType.VIDEO, 2);
    expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(30);
  });

  it('removes segments', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInit(ContentType.VIDEO);
    await Promise.all([
      append(ContentType.VIDEO, 0),
      append(ContentType.VIDEO, 1),
      append(ContentType.VIDEO, 2),
    ]);
    expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(30);
    await remove(ContentType.VIDEO, 0);
    expect(bufferStart(ContentType.VIDEO)).toBeCloseTo(10);
    expect(buffered(ContentType.VIDEO, 10)).toBeCloseTo(20);
    await remove(ContentType.VIDEO, 1);
    expect(bufferStart(ContentType.VIDEO)).toBe(20);
    expect(buffered(ContentType.VIDEO, 20)).toBeCloseTo(10);
    await remove(ContentType.VIDEO, 2);
    expect(bufferStart(ContentType.VIDEO)).toBe(null);
  });

  it('extends the duration', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(0);
    await appendInit(ContentType.VIDEO);
    await mediaSourceEngine.setDuration(20);
    expect(mediaSource.duration).toBeCloseTo(20);
    await append(ContentType.VIDEO, 0);
    expect(mediaSource.duration).toBeCloseTo(20);
    await mediaSourceEngine.setDuration(35);
    expect(mediaSource.duration).toBeCloseTo(35);
    await Promise.all([
      append(ContentType.VIDEO, 1),
      append(ContentType.VIDEO, 2),
      append(ContentType.VIDEO, 3),
    ]);
    expect(mediaSource.duration).toBeCloseTo(40);
    await mediaSourceEngine.setDuration(60);
    expect(mediaSource.duration).toBeCloseTo(60);
  });

  it('ends the stream, truncating the duration', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInit(ContentType.VIDEO);
    await append(ContentType.VIDEO, 0);
    await append(ContentType.VIDEO, 1);
    await append(ContentType.VIDEO, 2);
    await mediaSourceEngine.endOfStream();
    expect(mediaSource.duration).toBeCloseTo(30);
  });

  it('does not throw if endOfStrem called more than once', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInit(ContentType.VIDEO);
    await append(ContentType.VIDEO, 0);
    // Call endOfStream twice. There should be no exception.
    await mediaSourceEngine.endOfStream();
    await mediaSourceEngine.endOfStream();
  });

  it('queues operations', async () => {
    /** @type {!Array.<number>} */
    const resolutionOrder = [];
    /** @type {!Array.<!Promise>} */
    const requests = [];

    function checkOrder(p) {
      const nextIndex = requests.length;
      requests.push(p.then(() => {
        resolutionOrder.push(nextIndex);
      }));
    }

    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    checkOrder(mediaSourceEngine.setDuration(presentationDuration));
    checkOrder(appendInit(ContentType.VIDEO));
    checkOrder(append(ContentType.VIDEO, 0));
    checkOrder(append(ContentType.VIDEO, 1));
    checkOrder(append(ContentType.VIDEO, 2));
    checkOrder(mediaSourceEngine.endOfStream());

    await Promise.all(requests);
    expect(resolutionOrder).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('buffers MP4 audio', async () => {
    const initObject = new Map();
    initObject.set(ContentType.AUDIO, getFakeStream(metadata.audio));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    // NOTE: For some reason, this appendInit never resolves on my Windows VM.
    // The test operates correctly on real hardware.
    await appendInit(ContentType.AUDIO);
    expect(buffered(ContentType.AUDIO, 0)).toBe(0);
    await append(ContentType.AUDIO, 0);
    expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(10, 1);
    await append(ContentType.AUDIO, 1);
    expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(20, 1);
    await append(ContentType.AUDIO, 2);
    expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(30, 1);
  });

  it('buffers MP4 video and audio', async () => {
    const initObject = new Map();
    initObject.set(ContentType.AUDIO, getFakeStream(metadata.audio));
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));

    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);

    const audioStreaming = async () => {
      await appendInit(ContentType.AUDIO);
      await append(ContentType.AUDIO, 0);
      expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(10, 1);
      await append(ContentType.AUDIO, 1);
      expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(20, 1);
      await append(ContentType.AUDIO, 2);
      expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(30, 1);
      await append(ContentType.AUDIO, 3);
      expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(40, 1);
      await append(ContentType.AUDIO, 4);
      expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(50, 1);
      await append(ContentType.AUDIO, 5);
      expect(buffered(ContentType.AUDIO, 0)).toBeCloseTo(60, 1);
    };

    const videoStreaming = async () => {
      await appendInit(ContentType.VIDEO);
      await append(ContentType.VIDEO, 0);
      expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(10);
      await append(ContentType.VIDEO, 1);
      expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(20);
      await append(ContentType.VIDEO, 2);
      expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(30);
      await append(ContentType.VIDEO, 3);
      expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(40);
      await append(ContentType.VIDEO, 4);
      expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(50);
      await append(ContentType.VIDEO, 5);
      expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(60);
    };

    await Promise.all([audioStreaming(), videoStreaming()]);
    await mediaSourceEngine.endOfStream();
    expect(mediaSource.duration).toBeCloseTo(60, 1);
  });

  it('trims content at the append window', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInit(ContentType.VIDEO);
    await mediaSourceEngine.setStreamProperties(ContentType.VIDEO,
        /* timestampOffset= */ 0,
        /* appendWindowStart= */ 5,
        /* appendWindowEnd= */ 18,
        /* sequenceMode= */ false);
    expect(buffered(ContentType.VIDEO, 0)).toBe(0);
    await append(ContentType.VIDEO, 0);
    expect(bufferStart(ContentType.VIDEO)).toBeCloseTo(5, 1);
    expect(buffered(ContentType.VIDEO, 5)).toBeCloseTo(5, 1);
    await append(ContentType.VIDEO, 1);
    expect(buffered(ContentType.VIDEO, 5)).toBeCloseTo(13, 1);
  });

  it('does not initialize timestamp offset in sequence mode', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInit(ContentType.VIDEO);
    await mediaSourceEngine.setStreamProperties(ContentType.VIDEO,
        /* timestampOffset= */ 100,
        /* appendWindowStart= */ 5,
        /* appendWindowEnd= */ 18,
        /* sequenceMode= */ true);
    expect(buffered(ContentType.VIDEO, 0)).toBe(0);
    await append(ContentType.VIDEO, 0);
    expect(bufferStart(ContentType.VIDEO)).toBeCloseTo(5, 1);
    expect(buffered(ContentType.VIDEO, 5)).toBeCloseTo(5, 1);
    await append(ContentType.VIDEO, 1);
    expect(buffered(ContentType.VIDEO, 5)).toBeCloseTo(13, 1);
  });

  it('does not remove when overlap is outside append window', async () => {
    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    await mediaSourceEngine.init(initObject, false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInit(ContentType.VIDEO);
    // Simulate period 1, with 20 seconds of content, no timestamp offset
    await mediaSourceEngine.setStreamProperties(ContentType.VIDEO,
        /* timestampOffset= */ 0,
        /* appendWindowStart= */ 0,
        /* appendWindowEnd= */ 20,
        /* sequenceMode= */ false);
    await append(ContentType.VIDEO, 0);
    await append(ContentType.VIDEO, 1);
    expect(bufferStart(ContentType.VIDEO)).toBeCloseTo(0, 1);
    expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(20, 1);

    // Simulate period 2, with 20 seconds of content offset back by 5 seconds.
    // The 5 seconds of overlap should be trimmed off, and we should still
    // have a continuous stream with 35 seconds of content.
    await mediaSourceEngine.setStreamProperties(ContentType.VIDEO,
        /* timestampOffset= */ 15,
        /* appendWindowStart= */ 20,
        /* appendWindowEnd= */ 35,
        /* sequenceMode= */ false);
    await append(ContentType.VIDEO, 0);
    await append(ContentType.VIDEO, 1);
    expect(bufferStart(ContentType.VIDEO)).toBeCloseTo(0, 1);
    expect(buffered(ContentType.VIDEO, 0)).toBeCloseTo(35, 1);
  });

  it('extracts CEA-708 captions from hls', async () => {
    // Load TS file with CEA-708 captions.
    metadata = shaka.test.TestScheme.DATA['cea-708_ts'];
    generators = shaka.test.TestScheme.GENERATORS['cea-708_ts'];

    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));
    initObject.set(ContentType.TEXT, getFakeStream(metadata.text));
    // Call with forceTransmuxTS = true, so that it will transmux even on
    // platforms with native TS support.
    await mediaSourceEngine.init(initObject, /* forceTransmuxTS= */ true);
    mediaSourceEngine.setSelectedClosedCaptionId('CC1');
    await append(ContentType.VIDEO, 0);

    expect(textDisplayer.appendSpy).toHaveBeenCalledTimes(3);
  });

  it('extracts CEA-708 captions from dash', async () => {
    // Load MP4 file with CEA-708 closed captions.
    metadata = shaka.test.TestScheme.DATA['cea-708_mp4'];
    generators = shaka.test.TestScheme.GENERATORS['cea-708_mp4'];

    const initObject = new Map();
    initObject.set(ContentType.VIDEO, getFakeStream(metadata.video));

    await mediaSourceEngine.init(initObject, /* forceTransmuxTS= */ false);
    await mediaSourceEngine.setDuration(presentationDuration);
    await appendInitWithClosedCaptions(ContentType.VIDEO);
    mediaSourceEngine.setSelectedClosedCaptionId('CC1');
    await appendWithClosedCaptions(ContentType.VIDEO, 0);

    expect(textDisplayer.appendSpy).toHaveBeenCalled();
  });
});
