import SerialPort from 'serialport';

// Bus Pirate API (requires at at least firmware version 6.1, only tested on hardware version 3.6)

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms, void 0));
const toHex = (n: number, l = 2) => `0x${n.toString(16).padStart(l, '0')}`;
const withDefault = <T>(x: T, y: T): T => typeof x !== 'undefined' ? x : y;

const MHz = 1_000_000;
const KiB = 1024;

const DEFAULT_TIMEOUT = process.env.DEFAULT_TIMEOUT ? Number(process.env.DEFAULT_TIMEOUT) : 100;

export enum BusPirateMode {
  BitBang = 'BitBang',
  SPI     = 'SPI',
  I2C     = 'I2C',
  UART    = 'UART',
  OneWire = 'OneWire',
  RawWire = 'RawWire',
}

const ModeCode: Record<BusPirateMode, number> = {
  [BusPirateMode.BitBang]: 0x00,
  [BusPirateMode.SPI]:     0x01,
  [BusPirateMode.I2C]:     0x02,
  [BusPirateMode.UART]:    0x03,
  [BusPirateMode.OneWire]: 0x04,
  [BusPirateMode.RawWire]: 0x05,
}

const ModeResponse: Record<BusPirateMode, string> = {
  [BusPirateMode.SPI]:     'SPI1',
  [BusPirateMode.I2C]:     'I2C1',
  [BusPirateMode.UART]:    'ART1',
  [BusPirateMode.OneWire]: '1W01',
  [BusPirateMode.RawWire]: 'RAW1',
  [BusPirateMode.BitBang]: 'BBIO1',
}

export enum I2CAUXCommand {
  AUX_CS_Low  = 0x00,
  AUX_CS_High = 0x01,
  AUX_CS_HiZ  = 0x02,
  AUX_Read    = 0x03,
  Use_AUX     = 0x10,
  Use_CS      = 0x20,
}

export enum LogicLevel {
  Low  = 0,
  High = 1,
};

export enum ChipSelectActiveState {
  ActiveLow  = 0,
  ActiveHigh = 1,
};


export enum ChipSelectControl {
  Manual    = 0,
  Automatic = 1,
};

export enum PinOutputHigh {
  HiZ  = 0,
  v3_3 = 1,
};

export enum ClockIdlePhase {
  Low  = 0,
  High = 1,
};

export enum ClockOutputEdge {
  IdleToActive = 0,
  ActiveToIdle = 1,
};

export enum InputSamplePhase {
  Middle = 0,
  End    = 1,
};

export enum SPISpeed {
  kHz_30  = 0x00,
  kHz_125 = 0x01,
  kHz_250 = 0x02,
  MHz_1   = 0x03,
  MHz_2   = 0x04,
  MHz_2_6 = 0x05,
  MHz_4   = 0x06,
  MHz_8   = 0x07,
};

export enum I2CSpeed {
  kHz_5   = 0x00,
  kHz_50  = 0x01,
  kHz_100 = 0x02,
  kHz_400 = 0x03,
}

enum PWMPrescaler {
  Scale1,
  Scale8,
  Scale64,
  Scale256
}

const PWMPrescalerValue: Record<PWMPrescaler, number> = {
  [PWMPrescaler.Scale1]:   0x001,
  [PWMPrescaler.Scale8]:   0x008,
  [PWMPrescaler.Scale64]:  0x040,
  [PWMPrescaler.Scale256]: 0x100,
}

export type PeripheralConfig = {
  powerEnabled: LogicLevel;
  pullUpsEnabled: LogicLevel;
  auxState: LogicLevel;
  csState: LogicLevel;
};

export enum PinInout {
  Input  = 1,
  Output = 0,
};
export type PinConfig = {
  Aux: PinInout;
  MOSI: PinInout;
  Clk: PinInout;
  MISO: PinInout;
  CS: PinInout;
};

export type PinStates = {
  Power: LogicLevel;
  Pullup: LogicLevel;
  Aux: LogicLevel;
  MOSI: LogicLevel;
  Clk: LogicLevel;
  MISO: LogicLevel;
  CS: LogicLevel;
};

export type BufferLike = Uint8Array | Array<number> | Buffer;

export type BusPirateParams = {
  devicePath: string;
};
export abstract class BusPirateBase {
  sp: SerialPort;
  rxBuffer = Buffer.from([]);
  dataStreamHandler: (data: Buffer) => void;

  constructor(params: BusPirateParams) {
    this.sp = new SerialPort(params.devicePath, {
      autoOpen: false,
      baudRate: 115200,
      dataBits: 8,
      parity: 'none',
      stopBits: 1
    });

    this.dataStreamHandler = (data: Buffer) => {
      this.rxBuffer = Buffer.concat([this.rxBuffer, data]);
    };

    this.sp.on('data', this.dataStreamHandler);
  }

  init() {
    if (this.sp.isOpen) {
      return this.enterBitBangMode();
    }
    return this.openSerial().then(() => this.enterBitBangMode());
  }

  rxLength() {
    return this.rxBuffer.byteLength;
  }

  rxClear() {
    return this.rxBuffer = Buffer.from([]);
  }

  rxPeek(n?: number) {
    if (n === undefined) {
      console.log(this.rxBuffer);
    } else {
      console.log(this.rxBuffer.slice(0, n));
    }
  }

  rxRead(n: number) {
    if (this.rxLength() < n) return null;
    const bytes = this.rxBuffer.slice(0, n);
    this.rxBuffer = this.rxBuffer.slice(n);
    return bytes;
  }

  rxReadString(n: number) {
    return this.rxRead(n)?.toString();
  }

  rxReadU8() {
    const byte = this.rxRead(1);
    if (!byte) return null;
    return byte[0];
  }

  rxReadU16() {
    const bytes = this.rxRead(2);
    if (!bytes) return null;
    return (bytes[0] << 8) | bytes[1];
  }

  rxReadU32() {
    const bytes = this.rxRead(4);
    if (!bytes) return null;
    return (
        (bytes[0] << 24)
      | (bytes[1] << 16)
      | (bytes[2] << 8)
      | (bytes[3] << 0)
    );
  }

  rxPop() {
    if (this.rxLength() < 1) return null;
    const byte = this.rxBuffer[this.rxBuffer.byteLength - 1];
    this.rxBuffer = this.rxBuffer.slice(0, this.rxBuffer.byteLength - 1);
    return byte;
  }

  async reset() {
    // Found this sequence in an image for the i2c binary mode
    // Not the most...well documented API, but I'm glad it works!
    this.sp.write([0x00, 0x00, 0x00, 0x00, 0x0f, 0x11, 0x0d, 0x0a]);

    await delay(DEFAULT_TIMEOUT);
    this.rxClear();
  }

  private openSerial() {
    return new Promise<void>((res, rej) => {
      this.sp.open(err => err ? rej(err) : res(void 0));
    });
  }

  async waitForBytesAvailable(n = 1, timeoutMs = DEFAULT_TIMEOUT) {
    this.sp.flush();
    let waited = 0;
    while (1) {
      if (this.rxBuffer.length >= n) return;

      if (waited === timeoutMs) {
        console.log('dump', this.rxBuffer);
        throw new Error(`Timed out waiting for ${n} bytes to be available`);
      }

      await delay(10);
      waited += 10;
    }
  }

  async expectAck(context: string, timeoutMs?: number) {
    await this.waitForBytesAvailable(1, timeoutMs);
    const ack = this.rxReadU8();
    if (ack !== 0x01) {
      this.rxPeek();
      throw new Error(`Invalid response during [${context}] (${toHex(ack)})}`);
    }
  }

  private async enterBitBangMode() {
    // Clear anything in the rxBuffer
    this.rxClear();

    // Try to determine what kind of state the device is currently in by sending 0x01
    // When in a bitbang type mode, this should either transition to SPI mode, or report
    // the currently active protocol name
    this.sp.write([0x01]);
    await delay(DEFAULT_TIMEOUT);

    if (this.rxLength() >= 4) {
      // Clear anything in the buffer
      await this.rxClear();

      // Reset into the regular bus pirate mode
      await this.reset();

      // Re-enter bitbang mode
      await this.enterBitBangMode();

      return;
    }

    // If we recieve 0x07, then the device is NOT in bitbang mode yet
    let bbResp = this.rxReadU8();
    if (this.rxLength() === 1 && bbResp !== 0x07) {
      // Anything else is unexpected
      throw new Error(`Unexpected response from device during init (bitbang inquiry resp=${bbResp}`);
    }

    // Put the device into bitbang mode by sending 20 null bytes
    this.sp.write(Array.from({length: 20}, () => 0x00));

    // Give the device some time to respond
    const responseBytes = ModeResponse[BusPirateMode.BitBang].length
    await this.waitForBytesAvailable(responseBytes);

    // Check that the correct response was sent
    const resp = this.rxReadString(responseBytes);
    if (resp !== ModeResponse[BusPirateMode.BitBang]) {
      throw new Error(`Device returned incorrect response during bitbang mode init (${resp})`);
    }

    // Give the device some time to send any misc copies of
    // BPResponseString.BitBangMode
    await delay(DEFAULT_TIMEOUT);

    // Clear anything in the rx buffer out
    this.rxClear();
  }

  async close() {
    await this.reset();
    return new Promise<void>((res, rej) => {
      this.sp.close(err => err ? rej(err) : res(void 0));
    });
  }
}

export class BitBangMode extends BusPirateBase {
  private pinStates: PinStates = {
    Power: LogicLevel.Low,
    Pullup: LogicLevel.Low,
    Aux: LogicLevel.Low,
    MOSI: LogicLevel.Low,
    Clk: LogicLevel.Low,
    MISO: LogicLevel.Low,
    CS: LogicLevel.Low,
  };

  async readAdc() {
    // Ask for a 16 bit adc measurement
    this.sp.write([0x14]);
    await this.waitForBytesAvailable(2);
    return this.rxReadU16();
  }

  async measureFrequency() {
    // Ask for a 32 bit frequency measurement
    this.sp.write([0x16]);

    // This can actually take a little time - a 5 second window should be enough
    await this.waitForBytesAvailable(4, 5 * 1000);
    return this.rxReadU32();
  }

  async pwm(dutyCyclePercent: number, periodFreq: number) {
    // https://github.com/juhasch/pyBusPirateLite/blob/eb905b3eb7d031025003ce44d36e91a6b2f62122/pyBusPirateLite/BitBang.py#L219
    const dutyCycle = dutyCyclePercent / 100;
    const period = 1 / (periodFreq);
    const Tcy = 2 / (32 * MHz);

    let PRy = 0;
    let OCR = 0;
    let foundPrescaler = -1;

    for (let prescaler: PWMPrescaler = 0; prescaler < Object.keys(PWMPrescaler).length; prescaler++) {
      PRy = period * (1 / (Tcy * PWMPrescalerValue[prescaler]));
      PRy = (PRy - 1) >>> 0;
      OCR = PRy * dutyCycle;

      if (PRy < 0xffff) {
        // This is a valid configuration
        foundPrescaler = prescaler;
        break;
      }
    }

    if (foundPrescaler === -1) {
      return false;
    }

    this.sp.write([
      0x12,
      foundPrescaler,
      (OCR >> 8) & 0xff, OCR & 0xff,
      (PRy >> 8) & 0xff, PRy & 0xff,
    ]);

    await this.expectAck('pwm');
    return true;
  }

  async pwmOff() {
    this.sp.write([0x13]);
    await this.expectAck('pwm off');
  }

  async configurePins(pinConfig: PinConfig) {
    this.sp.write([0x40 | (
        (pinConfig.Aux    << 4)
      | (pinConfig.MOSI   << 3)
      | (pinConfig.Clk    << 2)
      | (pinConfig.MISO   << 1)
      | (pinConfig.CS     << 0)
    )]);

    await this.waitForBytesAvailable(1);
    return this.rxReadU8();
  }

  async setPinStates(states: PinStates) {
    this.sp.write([0x80 | (
        (states.Power  << 6)
      | (states.Pullup << 5)
      | (states.Aux    << 4)
      | (states.MOSI   << 3)
      | (states.Clk    << 2)
      | (states.MISO   << 1)
      | (states.CS     << 0)
    )]);

    this.pinStates = states;

    await this.waitForBytesAvailable(1);
    return this.rxReadU8();
  }

  async getPinStates() {
    const states = await this.setPinStates(this.pinStates);
    return {
      Power:  (states >>> 6) & 1,
      Pullup: (states >>> 5) & 1,
      Aux:    (states >>> 4) & 1,
      MOSI:   (states >>> 3) & 1,
      Clk:    (states >>> 2) & 1,
      MISO:   (states >>> 1) & 1,
      CS:     (states >>> 0) & 1,
    } as PinStates;
  }

  async setPower(state: LogicLevel) {
    this.pinStates.Power = state;
    return this.setPinStates(this.pinStates);
  }

  async setPullup(state: LogicLevel) {
    this.pinStates.Pullup = state;
    return this.setPinStates(this.pinStates);
  }

  async setAux(state: LogicLevel) {
    this.pinStates.Aux = state;
    return this.setPinStates(this.pinStates);
  }

  async setMOSI(state: LogicLevel) {
    this.pinStates.MOSI = state;
    return this.setPinStates(this.pinStates);
  }

  async setClk(state: LogicLevel) {
    this.pinStates.Clk = state;
    return this.setPinStates(this.pinStates);
  }

  async setMISO(state: LogicLevel) {
    this.pinStates.MISO = state;
    return this.setPinStates(this.pinStates);
  }

  async setCS(state: LogicLevel) {
    this.pinStates.CS = state;
    return this.setPinStates(this.pinStates);
  }

  async getPower() {
    const states = await this.setPinStates(this.pinStates);
    return (states >>> 6) & 1;
  }

  async getPullup() {
    const states = await this.setPinStates(this.pinStates);
    return (states >>> 5) & 1;
  }

  async getAux() {
    const states = await this.setPinStates(this.pinStates);
    return (states >>> 4) & 1;
  }

  async getMOSI() {
    const states = await this.setPinStates(this.pinStates);
    return (states >>> 3) & 1;
  }

  async getClk() {
    const states = await this.setPinStates(this.pinStates);
    return (states >>> 2) & 1;
  }

  async getMISO() {
    const states = await this.setPinStates(this.pinStates);
    return (states >>> 1) & 1;
  }

  async getCS() {
    const states = await this.setPinStates(this.pinStates);
    return (states >>> 0) & 1;
  }
}

export type SPIModeParams = BusPirateParams & Partial<{
  speed: SPISpeed;
  pinOutputHigh: PinOutputHigh;
  clockIdlePhase: ClockIdlePhase;
  clockOutputEdge: ClockOutputEdge;
  inputSamplePhase: InputSamplePhase;
  chipSelectActive: ChipSelectActiveState;
}>;
export class SPIMode extends BusPirateBase {
  private transferInProgress = false;

  private powerEnabled = LogicLevel.Low;
  private pullUpsEnabled = LogicLevel.Low;
  private cs = LogicLevel.Low;
  private aux = LogicLevel.Low;
  private speed = SPISpeed.MHz_1;
  private clockIdlePhase = ClockIdlePhase.Low;
  private clockOutputEdge = ClockOutputEdge.ActiveToIdle;
  private inputSamplePhase = InputSamplePhase.Middle;
  private pinOutputHigh = PinOutputHigh.v3_3;
  private chipSelectActiveState = ChipSelectActiveState.ActiveLow;

  constructor(params: SPIModeParams) {
    super(params);

    this.speed = withDefault(params.speed, SPISpeed.MHz_1);
    this.clockIdlePhase = withDefault(params.clockIdlePhase, ClockIdlePhase.Low);
    this.clockOutputEdge = withDefault(params.clockOutputEdge, ClockOutputEdge.ActiveToIdle);
    this.inputSamplePhase = withDefault(params.inputSamplePhase, InputSamplePhase.Middle);
    this.pinOutputHigh = withDefault(params.pinOutputHigh, PinOutputHigh.v3_3);
  }

  async init() {
    await super.init();

    // SPI specific stuff
    this.sp.write([ModeCode[BusPirateMode.SPI]]);

    // Wait for the mode response to be sent
    const bytesInModeString = ModeResponse[BusPirateMode.SPI].length;
    await this.waitForBytesAvailable(bytesInModeString);

    // Check the response
    const resp = this.rxReadString(bytesInModeString);
    if (resp !== ModeResponse[BusPirateMode.SPI]) {
      console.log(this.rxPeek());
      throw new Error(`Device returned incorrect response entering SPI Mode (${resp})`);
    }

    // Initialise bus speed
    this.sp.write([0x60 | this.speed]);
    await this.expectAck('SPI Init: Bus speed');

    // Primary SPI config
    this.sp.write([0x80 | (
        (this.pinOutputHigh    << 3)
      | (this.clockIdlePhase   << 2)
      | (this.clockOutputEdge  << 1)
      | (this.inputSamplePhase << 0)
    )]);

    await this.expectAck('SPI Init: Config');
  }

  async configurePeripherals(config: PeripheralConfig) {
    this.powerEnabled = config.powerEnabled;
    const shouldTogglePullUps = this.pullUpsEnabled !== config.pullUpsEnabled;
    this.pullUpsEnabled = config.pullUpsEnabled;
    this.aux = config.auxState;
    this.cs = config.csState;

    const power = config.powerEnabled ? 1 : 0;
    const pullups = shouldTogglePullUps ? 1 : 0;

    const configByte = 0x40 | (
        (power           << 3)
      | (pullups         << 2)
      | (config.auxState << 1)
      | (config.csState  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Configure Peripherals');
  }

  async setSpeed(speed: SPISpeed) {
    if (this.speed === speed) return;
    this.speed = speed;
    this.sp.write([0x60 | this.speed]);
    await this.expectAck('Set Bus speed');
  }

  async configureSPI(config: Required<SPIModeParams>) {
    this.pinOutputHigh = config.pinOutputHigh;
    this.clockIdlePhase = config.clockIdlePhase;
    this.clockOutputEdge = config.clockOutputEdge;
    this.inputSamplePhase = config.inputSamplePhase;

    this.sp.write([0x80 | (
        (this.pinOutputHigh    << 3)
      | (this.clockIdlePhase   << 2)
      | (this.clockOutputEdge  << 1)
      | (this.inputSamplePhase << 0)
    )]);

    await this.expectAck('Configure SPI');
  }

  async setPinOutputHigh(pinOutput: PinOutputHigh) {
    if (this.pinOutputHigh === pinOutput) return;
    this.pinOutputHigh = pinOutput;

    this.sp.write([0x80 | (
        (this.pinOutputHigh    << 3)
      | (this.clockIdlePhase   << 2)
      | (this.clockOutputEdge  << 1)
      | (this.inputSamplePhase << 0)
    )]);

    await this.expectAck('Set Pin Output High');
  }

  async setClockIdlePhase(clockIdlePhase: ClockIdlePhase) {
    if (this.clockIdlePhase === clockIdlePhase) return;
    this.clockIdlePhase = clockIdlePhase;

    this.sp.write([0x80 | (
        (this.pinOutputHigh    << 3)
      | (this.clockIdlePhase   << 2)
      | (this.clockOutputEdge  << 1)
      | (this.inputSamplePhase << 0)
    )]);

    await this.expectAck('Set Clock Idle Phase');
  }

  async setClockOutputEdge(clockOutputEdge: ClockOutputEdge) {
    if (this.clockOutputEdge === clockOutputEdge) return;
    this.clockOutputEdge = clockOutputEdge;

    this.sp.write([0x80 | (
        (this.pinOutputHigh    << 3)
      | (this.clockIdlePhase   << 2)
      | (this.clockOutputEdge  << 1)
      | (this.inputSamplePhase << 0)
    )]);

    await this.expectAck('Set Clock Output Edge');
  }

  async setInputSamplePhase(inputSamplePhase: InputSamplePhase) {
    if (this.inputSamplePhase === inputSamplePhase) return;
    this.inputSamplePhase = inputSamplePhase;

    this.sp.write([0x80 | (
        (this.pinOutputHigh    << 3)
      | (this.clockIdlePhase   << 2)
      | (this.clockOutputEdge  << 1)
      | (this.inputSamplePhase << 0)
    )]);

    await this.expectAck('Set Input Sample Edge');
  }

  async setPower(enabled: LogicLevel) {
    if (this.powerEnabled === enabled) return;

    this.powerEnabled = enabled;
    const power = (enabled === LogicLevel.High) ? 1 : 0;
    const configByte = 0x40 | (
        (power    << 3)
      | (this.aux << 1)
      | (this.cs  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Set Power');
  }

  async setPullups(enabled: LogicLevel) {
    const shouldTogglePullUps = this.pullUpsEnabled !== enabled;

    if (!shouldTogglePullUps) return;

    const power = this.powerEnabled ? 1 : 0;
    const configByte = 0x40 | (
        (power    << 3)
      | (1        << 2) // 1, since this indicates a toggle
      | (this.aux << 1)
      | (this.cs  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Set Pullups');
  }

  async setCS(level: LogicLevel) {
    if (this.cs === level) return;
    this.cs = level;

    const byte = level === LogicLevel.Low
      ? 0x02
      : 0x03;
    this.sp.write([byte]);
    await this.expectAck(`Set CS`);
  }

  async setAux(level: LogicLevel) {
    if (this.aux === level) return;

    this.aux = level;
    const power = this.powerEnabled ? 1 : 0;
    const configByte = 0x40 | (
        (power    << 3)
      | (this.aux << 1)
      | (this.cs  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Set AUX');
  }

  setCSActiveState(activeState: ChipSelectActiveState) {
    this.chipSelectActiveState = activeState;
  }

  chipSelectEnable() {
    if (this.chipSelectActiveState === ChipSelectActiveState.ActiveLow) {
      return this.setCS(LogicLevel.Low);
    } else {
      return this.setCS(LogicLevel.High);
    }
  }

  chipSelectDisable() {
    if (this.chipSelectActiveState === ChipSelectActiveState.ActiveLow) {
      return this.setCS(LogicLevel.High);
    } else {
      return this.setCS(LogicLevel.Low);
    }
  }

  async transfer(transferData: BufferLike, csControl: ChipSelectControl) {
    // We can't transfer if there's already a transfer in progress
    if (this.transferInProgress) {
      throw new Error('Transfer already in progress');
    }

    // We need at least one byte to send
    if (transferData.length === 0) {
      throw new Error('Bulk transfer requires at least one byte to be sent');
    }

    this.transferInProgress = true;

    const dataBuffer = Array.isArray(transferData) ? Buffer.from(transferData) : transferData;
    let rxData = Buffer.from([]);

    // Enable chip select
    if (csControl === ChipSelectControl.Automatic) await this.chipSelectEnable();

    // The transfer command on the bus pirate can only send 16 bytes at a time
    // So we need to break the users send buffer into chunks, and initiate a series
    // of bulk transfers.
    // Note that since this is all part of a single transfer from the point of view
    // of the SPI bus, we only assert the chip select signal once
    for (let i = 0; i < dataBuffer.byteLength; i += 16) {
      // Send the relevant piece of the users buffer in a bulk transfer
      const slice = dataBuffer.slice(i, i+16);
      this.sp.write(Buffer.concat([
        Buffer.from([0x10 | (slice.length - 1)]),
        slice,
      ]));

      // Wait for the transfer success (this removes the byte from the rxBuffer)
      await this.expectAck('SPI transfer');

      // Allow a little longer than normal, since we're sending more data at once
      await this.waitForBytesAvailable(slice.byteLength, DEFAULT_TIMEOUT * 2);

      // Whatever is in the rxBuffer now is the actual data from the SPI bus
      // Copy it to a local recieve buffer
      rxData = Buffer.concat([
        rxData,
        this.rxBuffer
      ]);

      // Clear all data in the local rxBuffer
      this.rxClear();
    }

    // Complete transfer is complete, disable chip select
    if (csControl === ChipSelectControl.Automatic) await this.chipSelectDisable();

    this.transferInProgress = false;

    return rxData;
  }

  async bpWriteThenRead(command: number, transferData: BufferLike, readBytes: number, csControl: ChipSelectControl) {
    // We can't transfer if there's already a transfer in progress
    if (this.transferInProgress) {
      throw new Error('Transfer already in progress');
    }

    const bytesToTransfer = transferData.length;
    const dataBuffer = Buffer.from(transferData);

    // We can only send maximum 16 bytes at a time
    if (bytesToTransfer > 4*KiB) {
      throw new Error(`writeThenRead: Can only send up to 4KiB at a time (${bytesToTransfer})`);
    }

    this.transferInProgress = true;

    if (csControl === ChipSelectControl.Automatic) await this.chipSelectEnable();

    // Send the command, tx length, rx length
    this.sp.write(Buffer.from([
      (csControl === ChipSelectControl.Manual ? 0x05 : 0x04),
      command,
      (bytesToTransfer >> 8) & 0xff, (bytesToTransfer & 0xff),
      (readBytes >> 8) & 0xff, (readBytes & 0xff),
    ]));

    // Send the actual data
    this.sp.write(dataBuffer);

    await this.expectAck('SPI write then read', 5000);
    await this.waitForBytesAvailable(readBytes, 2500);

    // Slice the data recieved out of the rxBuffer
    const rxData = this.rxBuffer;

    // Clear the data
    this.rxClear();

    if (csControl === ChipSelectControl.Automatic) await this.chipSelectDisable();

    this.transferInProgress = false;

    return rxData;
  }

  async writeThenRead(command: number, transferData: BufferLike, readBytes: number, csControl: ChipSelectControl) {
    if (readBytes <= 0) {
      throw new Error(`writeThenRead: Need to recieve at least one byte`);
    }

    const txBuffer = Buffer.concat([
      Buffer.from([command]),
      Buffer.from(transferData),
      Buffer.from(Array.from({length: readBytes}, () => 0))
    ]);

    const rxData = await this.transfer(txBuffer, csControl);
    return rxData.slice(1 + transferData.length);
  }

  async commandThenRead(command: number, readBytes: number, csControl: ChipSelectControl) {
    if (readBytes <= 0) {
      throw new Error(`commandThenRead: Need to recieve at least one byte`);
    }
    return this.writeThenRead(command, [], readBytes, csControl);
  }

  getPowerEnabled() { return this.powerEnabled; }
  getPullUpsEnabled() { return this.pullUpsEnabled; }
  getCs() { return this.cs; }
  getAux() { return this.aux; }
  getSpeed() { return this.speed; }
  getClockIdlePhase() { return this.clockIdlePhase; }
  getClockOutputEdge() { return this.clockOutputEdge; }
  getInputSamplePhase() { return this.inputSamplePhase; }
  getPinOutputHigh() { return this.pinOutputHigh; }
  getChipSelectActiveState() { return this.chipSelectActiveState; }
}

export type I2CModeParams = BusPirateParams & Partial<{
  speed: I2CSpeed;
}>;
export class I2CMode extends BusPirateBase {
  private transferInProgress = false;

  private powerEnabled = LogicLevel.Low;
  private pullUpsEnabled = LogicLevel.Low;
  private cs = LogicLevel.Low;
  private aux = LogicLevel.Low;
  private speed = I2CSpeed.kHz_400;

  constructor(params: I2CModeParams) {
    super(params);
    this.speed = withDefault(params.speed, I2CSpeed.kHz_400);
  }

  async init() {
    await super.init();

    // I2C specific stuff
    this.sp.write([ModeCode[BusPirateMode.I2C]]);

    // Wait for the mode response to be sent
    const bytesInModeString = ModeResponse[BusPirateMode.I2C].length;
    await this.waitForBytesAvailable(bytesInModeString);

    // Check the response
    const resp = this.rxReadString(bytesInModeString);
    if (resp !== ModeResponse[BusPirateMode.I2C]) {
      console.log(this.rxPeek());
      throw new Error(`Device returned incorrect response entering I2C Mode (${resp})`);
    }

    // Initialise bus speed
    this.sp.write([0x60 | this.speed]);
    await this.expectAck('I2C Init: Bus speed')

    // Set up default mode for peripherals
    await this.configurePeripherals({
      powerEnabled: this.powerEnabled,
      pullUpsEnabled: this.pullUpsEnabled,
      csState: this.cs,
      auxState: this.aux,
    });
  }

  async configurePeripherals(config: PeripheralConfig) {
    this.powerEnabled = config.powerEnabled;
    const shouldTogglePullUps = this.pullUpsEnabled !== config.pullUpsEnabled;
    this.pullUpsEnabled = config.pullUpsEnabled;
    this.aux = config.auxState;
    this.cs = config.csState;

    const power = config.powerEnabled ? 1 : 0;
    const pullups = shouldTogglePullUps ? 1 : 0;

    const configByte = 0x40 | (
        (power           << 3)
      | (pullups         << 2)
      | (config.auxState << 1)
      | (config.csState  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Configure Peripherals');
  }

  async setPower(enabled: LogicLevel) {
    if (this.powerEnabled === enabled) return;

    this.powerEnabled = enabled;
    const power = (enabled === LogicLevel.High) ? 1 : 0;
    const configByte = 0x40 | (
        (power    << 3)
      | (this.aux << 1)
      | (this.cs  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Set Power');
  }

  async setPullups(enabled: LogicLevel) {
    const shouldTogglePullUps = this.pullUpsEnabled !== enabled;

    if (!shouldTogglePullUps) return;

    const power = this.powerEnabled ? 1 : 0;
    const configByte = 0x40 | (
        (power    << 3)
      | (1        << 2) // 1, since this indicates a toggle
      | (this.aux << 1)
      | (this.cs  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Set Pullups');
  }

  async setCS(level: LogicLevel) {
    // TODO: Check if this can be done with the extended AUX command instead
    if (this.cs === level) return;
    this.cs = level;

    const power = (this.powerEnabled === LogicLevel.High) ? 1 : 0;
    const configByte = 0x40 | (
        (power    << 3)
      | (this.aux << 1)
      | (this.cs  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Set CS');
  }

  async setAux(level: LogicLevel) {
    if (this.aux === level) return;

    this.aux = level;
    const power = this.powerEnabled ? 1 : 0;
    const configByte = 0x40 | (
        (power    << 3)
      | (this.aux << 1)
      | (this.cs  << 0)
    );

    this.sp.write([configByte]);
    await this.expectAck('Set AUX');
  }

  async setSpeed(speed: I2CSpeed) {
    if (speed === this.speed) return;
    this.speed = speed;
    this.sp.write([0x60 | this.speed]);
    await this.expectAck('Set speed');
  }

  async ack() {
    this.sp.write([0x06]);
    this.expectAck('ack');
  }

  async nack() {
    this.sp.write([0x07]);
    this.expectAck('nack');
  }

  async startBit() {
    this.sp.write([0x02]);
    this.expectAck('start bit');
  }

  async stopBit() {
    this.sp.write([0x03]);
    this.expectAck('stop bit');
  }

  async write(transferData: BufferLike) {
    // We can't transfer if there's already a transfer in progress
    if (this.transferInProgress) {
      throw new Error('Transfer already in progress');
    }

    // We need at least one byte to send
    if (transferData.length === 0) {
      throw new Error('Bulk transfer requires at least one byte to be sent');
    }

    this.transferInProgress = true;

    const dataBuffer = Array.isArray(transferData) ? Buffer.from(transferData) : transferData;
    let rxData = Buffer.from([]);

    // The transfer command on the bus pirate can only send 16 bytes at a time
    // So we need to break the users send buffer into chunks, and initiate a series
    // of bulk transfers.
    for (let i = 0; i < dataBuffer.byteLength; i += 16) {
      // Send the relevant piece of the users buffer in a bulk transfer
      const slice = dataBuffer.slice(i, i+16);
      this.sp.write(Buffer.concat([
        Buffer.from([0x10 | (slice.length - 1)]),
        slice,
      ]));

      // Wait for the transfer success (this removes the byte from the rxBuffer)
      await this.expectAck('SPI transfer');

      // Allow a little longer than normal, since we're sending more data at once
      await this.waitForBytesAvailable(slice.byteLength, DEFAULT_TIMEOUT * 2);

      // Whatever is in the rxBuffer now is the actual data from the SPI bus
      // Copy it to a local recieve buffer
      rxData = Buffer.concat([
        rxData,
        this.rxBuffer
      ]);

      // Clear all data in the local rxBuffer
      this.rxClear();
    }

    this.transferInProgress = false;

    return rxData;
  }

  async auxExtension(command: I2CAUXCommand) {
    this.sp.write([0x09, command]);
    await delay(100);
    await this.expectAck(`AUX Extension Command ${toHex(command)}`);

    if (command === I2CAUXCommand.AUX_Read) {
      await this.waitForBytesAvailable(1);
      return this.rxReadU8();
    }

    if (command === I2CAUXCommand.Use_AUX || command === I2CAUXCommand.Use_CS) {
      await this.waitForBytesAvailable(1);
      return this.rxReadU8();
    }

    // Here's an interesting exception to the normal Bus Pirate binary mode:
    // AUX extension commands (apart from read & use xyz) return 0x01 for ack, followed
    // by an ASCII string like "AUX xxx\r\n" and another 0x01
    // So for sanitys sake we'll read a 3 byte string, check if it's AUX, and if it is
    // then we can clear the whole rx buffer and return

    await this.waitForBytesAvailable(3);
    const auxString = await this.rxReadString(3);
    if (auxString !== 'AUX') {
      throw new Error(`Unexpected response for AUX extension command ${toHex(command)} (${auxString})`);
    }

    this.rxClear();

    // Make the function consistent and return a number here. Since an aux read would only return 0 or 1,
    // returning a 2 here is a sure sign that we did basically anything else.
    // This whole AUX extension API should probably be thought through a bit and broken out later
    return 2;
  }

  getPowerEnabled() { return this.powerEnabled; }
  getPullUpsEnabled() { return this.pullUpsEnabled; }
  getCs() { return this.cs; }
  getAux() { return this.aux; }
  getSpeed() { return this.speed; }
}
